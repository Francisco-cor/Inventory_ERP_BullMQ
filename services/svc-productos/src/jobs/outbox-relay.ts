import { pool } from "../db/pool.js";
import { eventBus } from "../events/bus.js";
import { CURRENT_SCHEMA_VERSION } from "@erp/event-bus";

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 500);
const BATCH_SIZE = 10;

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startOutboxRelay(): void {
  if (timer) return;
  console.log(`[outbox-relay:productos] started — poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}`);
  timer = setInterval(() => void tick().catch((e) => console.error("[outbox-relay:productos] tick failed", e)), POLL_INTERVAL_MS);
  // initial tick
  void tick().catch(() => {});
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, nombre_evento, payload, correlation_id, created_at
       FROM outbox
       WHERE published_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );

    if (rows.length === 0) {
      await client.query("COMMIT");
      return;
    }

    for (const row of rows) {
      const event = {
        id: row.id,
        name: row.nombre_evento,
        payload: row.payload,
        timestamp: new Date(row.created_at).toISOString(),
        source: "svc-productos" as const,
        correlationId: row.correlation_id,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      try {
        // publishRaw preserves id/timestamp
        await (eventBus as unknown as { publishRaw: (e: typeof event) => Promise<void> }).publishRaw(event);
        await client.query(
          `UPDATE outbox SET published_at = NOW(), estado = 'published', attempts = attempts + 1 WHERE id = $1`,
          [row.id]
        );
        console.log(JSON.stringify({ level: "info", service: "svc-productos", outboxId: row.id, eventName: row.nombre_evento, msg: "outbox published" }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await client.query(
          `UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
          [row.id, msg.slice(0, 1000)]
        );
        console.error(JSON.stringify({ level: "error", service: "svc-productos", outboxId: row.id, error: msg, msg: "outbox publish failed" }));
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
    running = false;
  }
}
