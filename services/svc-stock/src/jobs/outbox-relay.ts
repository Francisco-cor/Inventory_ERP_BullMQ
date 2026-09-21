import { pool } from "../db/pool.js";
import { eventBus } from "../events/bus.js";
import { CURRENT_SCHEMA_VERSION } from "@erp/event-bus";
import { randomUUID } from "node:crypto";

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 500);
const BATCH_SIZE = 10;
const LEASE_MS = Math.max(1000, Number(process.env.OUTBOX_LEASE_MS ?? 30_000));

interface OutboxRow {
  id: string;
  nombre_evento: string;
  payload: unknown;
  correlation_id: string;
  created_at: Date;
  leaseToken: string;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startOutboxRelay(): void {
  if (timer) return;
  console.log(`[outbox-relay:stock] started — poll ${POLL_INTERVAL_MS}ms`);
  timer = setInterval(
    () => void tick().catch((e) => console.error("[outbox-relay:stock] tick failed", e)),
    POLL_INTERVAL_MS
  );
  void tick().catch(() => void 0);
}

export async function stopOutboxRelay(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rows = await claimBatch();
    for (const row of rows) {
      const event = {
        id: row.id,
        name: row.nombre_evento,
        payload: row.payload,
        timestamp: new Date(row.created_at).toISOString(),
        source: "svc-stock" as const,
        correlationId: row.correlation_id,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      try {
        await (
          eventBus as unknown as { publishRaw: (e: typeof event) => Promise<void> }
        ).publishRaw(event);
        await markPublished(row);
        console.log(
          JSON.stringify({
            level: "info",
            service: "svc-stock",
            outboxId: row.id,
            eventName: row.nombre_evento,
            msg: "outbox published",
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markFailed(row, msg);
        console.error(
          JSON.stringify({
            level: "error",
            service: "svc-stock",
            outboxId: row.id,
            error: msg,
            msg: "outbox publish failed",
          })
        );
      }
    }
  } finally {
    running = false;
  }
}

async function claimBatch(): Promise<OutboxRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, nombre_evento, payload, correlation_id, created_at
       FROM outbox
       WHERE published_at IS NULL
         AND (lease_until IS NULL OR lease_until < NOW())
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );
    const leaseToken = randomUUID();
    for (const row of rows) {
      await client.query(
        `UPDATE outbox
         SET lease_token = $2,
             lease_until = NOW() + ($3 * INTERVAL '1 millisecond')
         WHERE id = $1`,
        [row.id, leaseToken, LEASE_MS]
      );
    }
    await client.query("COMMIT");
    return rows.map((row) => ({ ...row, leaseToken }));
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
}

async function markPublished(row: OutboxRow): Promise<void> {
  await pool.query(
    `UPDATE outbox
     SET published_at = NOW(), estado = 'published', attempts = attempts + 1,
         lease_token = NULL, lease_until = NULL
     WHERE id = $1 AND lease_token = $2`,
    [row.id, row.leaseToken]
  );
}

async function markFailed(row: OutboxRow, message: string): Promise<void> {
  await pool.query(
    `UPDATE outbox
     SET attempts = attempts + 1, last_error = $2,
         lease_token = NULL, lease_until = NULL
     WHERE id = $1 AND lease_token = $3`,
    [row.id, message.slice(0, 1000), row.leaseToken]
  );
}
