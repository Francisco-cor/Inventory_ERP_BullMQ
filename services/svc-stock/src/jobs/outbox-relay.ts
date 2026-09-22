import { pool } from "../db/pool.js";
import { eventBus } from "../events/bus.js";
import { CURRENT_SCHEMA_VERSION, getEventBusDestinations } from "@erp/event-bus";
import type { DomainEvent, EventName, ServiceName } from "@erp/shared-types";
import { randomUUID } from "node:crypto";

const SERVICE_NAME: ServiceName = "svc-stock";
const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 500);
const BATCH_SIZE = 10;
const LEASE_MS = Math.max(1000, Number(process.env.OUTBOX_LEASE_MS ?? 30_000));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 20));

interface DeliveryRow {
  id: string;
  nombre_evento: string;
  payload: unknown;
  correlation_id: string;
  created_at: Date;
  destination: ServiceName;
  leaseToken: string;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startOutboxRelay(): void {
  if (timer) return;
  console.log(`[outbox-relay:${SERVICE_NAME}] started — poll ${POLL_INTERVAL_MS}ms`);
  timer = setInterval(
    () => void tick().catch((e) => console.error(`[outbox-relay:${SERVICE_NAME}] tick failed`, e)),
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
    for (const row of await claimBatch()) {
      const event: DomainEvent = {
        id: row.id,
        name: row.nombre_evento as EventName,
        payload: row.payload,
        timestamp: new Date(row.created_at).toISOString(),
        source: SERVICE_NAME,
        correlationId: row.correlation_id,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      try {
        await (
          eventBus as unknown as {
            publishRawToDestination: (
              event: DomainEvent,
              destination: ServiceName
            ) => Promise<void>;
          }
        ).publishRawToDestination(event, row.destination);
        await markPublished(row);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markFailed(row, message);
        console.error(
          JSON.stringify({
            level: "error",
            service: SERVICE_NAME,
            outboxId: row.id,
            destination: row.destination,
            error: message,
            msg: "outbox delivery failed",
          })
        );
      }
    }
  } finally {
    running = false;
  }
}

async function claimBatch(): Promise<DeliveryRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const destinations = getEventBusDestinations(SERVICE_NAME);
    await client.query(
      `INSERT INTO outbox_deliveries (outbox_id, destination)
       SELECT o.id, d.destination FROM outbox o
       CROSS JOIN unnest($1::text[]) AS d(destination)
       WHERE o.published_at IS NULL
       ON CONFLICT (outbox_id, destination) DO NOTHING`,
      [destinations]
    );
    const { rows } = await client.query(
      `SELECT o.id, o.nombre_evento, o.payload, o.correlation_id, o.created_at,
              d.destination
       FROM outbox_deliveries d JOIN outbox o ON o.id = d.outbox_id
       WHERE d.published_at IS NULL AND d.estado = 'pending'
         AND (d.lease_until IS NULL OR d.lease_until < NOW())
       ORDER BY d.created_at ASC, o.created_at ASC LIMIT $1
       FOR UPDATE OF d SKIP LOCKED`,
      [BATCH_SIZE]
    );
    const leaseToken = randomUUID();
    for (const row of rows) {
      await client.query(
        `UPDATE outbox_deliveries SET lease_token = $3,
         lease_until = NOW() + ($4 * INTERVAL '1 millisecond')
         WHERE outbox_id = $1 AND destination = $2`,
        [row.id, row.destination, leaseToken, LEASE_MS]
      );
    }
    await client.query("COMMIT");
    return rows.map((row) => ({ ...row, destination: row.destination as ServiceName, leaseToken }));
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

async function markPublished(row: DeliveryRow): Promise<void> {
  await pool.query(
    `WITH delivered AS (
       UPDATE outbox_deliveries
       SET published_at = NOW(), estado = 'published', attempts = attempts + 1,
           lease_token = NULL, lease_until = NULL
       WHERE outbox_id = $1 AND destination = $2 AND lease_token = $3
       RETURNING outbox_id
     )
     UPDATE outbox o
     SET estado = CASE
           WHEN EXISTS (SELECT 1 FROM outbox_deliveries x WHERE x.outbox_id = o.id AND x.estado = 'dlq')
             THEN 'failed'
           ELSE 'published'
         END,
         published_at = CASE
           WHEN EXISTS (SELECT 1 FROM outbox_deliveries x WHERE x.outbox_id = o.id AND x.estado = 'dlq')
             THEN o.published_at
           ELSE NOW()
         END,
         attempts = attempts + 1
     FROM delivered d
     WHERE o.id = d.outbox_id
       AND NOT EXISTS (SELECT 1 FROM outbox_deliveries p WHERE p.outbox_id = o.id AND p.published_at IS NULL AND p.estado = 'pending')`,
    [row.id, row.destination, row.leaseToken]
  );
}

async function markFailed(row: DeliveryRow, message: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE outbox_deliveries
       SET attempts = attempts + 1, last_error = $4, lease_token = NULL, lease_until = NULL
       WHERE outbox_id = $1 AND destination = $2 AND lease_token = $3
       RETURNING outbox_id, destination, attempts`,
      [row.id, row.destination, row.leaseToken, message.slice(0, 1000)]
    );
    const failed = rows[0] as
      { outbox_id: string; destination: string; attempts: number } | undefined;
    if (failed && failed.attempts >= MAX_ATTEMPTS) {
      await client.query(
        `INSERT INTO outbox_delivery_dlq
           (outbox_id, destination, nombre_evento, payload, correlation_id, attempts, last_error)
         SELECT $1, $2, nombre_evento, payload, correlation_id, $3, $4
         FROM outbox WHERE id = $1
         ON CONFLICT (outbox_id, destination) DO NOTHING`,
        [failed.outbox_id, failed.destination, failed.attempts, message.slice(0, 1000)]
      );
      await client.query(
        `UPDATE outbox_deliveries SET estado = 'dlq', dead_lettered_at = NOW()
         WHERE outbox_id = $1 AND destination = $2`,
        [failed.outbox_id, failed.destination]
      );
      await client.query(
        `UPDATE outbox SET estado = 'failed'
         WHERE id = $1
           AND EXISTS (SELECT 1 FROM outbox_deliveries WHERE outbox_id = $1 AND estado = 'dlq')
           AND NOT EXISTS (SELECT 1 FROM outbox_deliveries WHERE outbox_id = $1 AND estado = 'pending' AND published_at IS NULL)`,
        [failed.outbox_id]
      );
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
}
