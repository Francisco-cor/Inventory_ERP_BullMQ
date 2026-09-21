import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { EVENTS } from "@erp/event-bus";
import { pool } from "../db/pool.js";
import { publishEvent } from "../events/publisher.js";
import { config } from "../config.js";

const SLA_THRESHOLD_SECONDS = config.SLA_THRESHOLD_SECONDS;
const CHECK_INTERVAL_MS = config.SLA_CHECK_INTERVAL_MS;

const QUEUE_NAME = "sla-checker";
const LOCK_KEY = "svc-obs:sla-checker:lock";
// Keep the lock alive for the configured interval plus a safety margin. A TTL
// shorter than the interval lets a slow check overlap with another replica.
const LOCK_TTL_MS = Math.max(config.SLA_LOCK_TTL_MS, CHECK_INTERVAL_MS + 10_000);

let queue: Queue | undefined;
let worker: Worker | undefined;

export async function startSlaChecker(redis: { host: string; port: number }): Promise<void> {
  const connection = { host: redis.host, port: redis.port };

  queue = new Queue(QUEUE_NAME, { connection });

  // Remove any existing repeatable jobs from previous runs
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Schedule the repeating job
  await queue.add("check-sla", {}, { repeat: { every: CHECK_INTERVAL_MS } });

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      // Distributed lock: only one svc-obs instance runs the check per interval.
      // Uses SET NX PX so the lock auto-expires if the process crashes mid-check.
      const redisClient = await queue!.client;
      const lockValue = randomUUID();
      const acquired = await redisClient.set(LOCK_KEY, lockValue, "PX", LOCK_TTL_MS, "NX");

      if (!acquired) {
        console.log("[sla-checker] Lock held by another instance — skipping run");
        return;
      }

      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // Find orders pending longer than the threshold
          const { rows } = await client.query<{
            orden_id: string;
            creada_en: Date;
            segundos: number;
          }>(
            `SELECT orden_id, creada_en,
                    EXTRACT(EPOCH FROM (NOW() - creada_en))::int AS segundos
             FROM ordenes_sla
             WHERE estado_sla = 'pendiente'
               AND creada_en < NOW() - ($1 * INTERVAL '1 second')`,
            [SLA_THRESHOLD_SECONDS]
          );

          if (rows.length === 0) {
            await client.query("COMMIT");
            return;
          }

          const orderIds = rows.map((r) => r.orden_id);

          await client.query(
            `UPDATE ordenes_sla
             SET estado_sla = 'sla_warning'
             WHERE orden_id = ANY($1::uuid[])
               AND estado_sla = 'pendiente'`,
            [orderIds]
          );

          // Publish through the outbox so SLA warnings have the same delivery
          // guarantees and audit trail as every other domain event.
          for (const row of rows) {
            const alert = {
              ordenId: row.orden_id,
              creadaEn: row.creada_en.toISOString(),
              segundosPendiente: row.segundos,
            };
            console.log(`[sla-checker] SLA_WARNING: orden ${row.orden_id} (${row.segundos}s)`);
            await publishEvent(EVENTS.SLA_WARNING, alert, row.orden_id, client);
          }
          await client.query("COMMIT");
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            void 0;
          }
          throw err;
        } finally {
          client.release();
        }
      } finally {
        // Release the lock only if we still hold it (guards against TTL expiry + re-acquisition)
        const current = await redisClient.get(LOCK_KEY);
        if (current === lockValue) {
          await redisClient.del(LOCK_KEY);
        }
      }
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    console.error(`[sla-checker] Job ${job?.id} failed: ${err.message}`);
  });

  console.log(
    `[sla-checker] Started — threshold: ${SLA_THRESHOLD_SECONDS}s, interval: ${CHECK_INTERVAL_MS}ms`
  );
}

export async function stopSlaChecker(): Promise<void> {
  await worker?.close();
  await queue?.close();
}
