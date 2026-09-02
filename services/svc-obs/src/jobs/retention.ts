import { pool } from "../db/pool.js";

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);
const BATCH_SIZE = 1000;

export async function runRetention(): Promise<number> {
  let total = 0;
  // event_log
  const { rowCount: c1 } = await pool.query(
    `DELETE FROM event_log WHERE emitido_en < NOW() - INTERVAL '1 day' * $1`,
    [RETENTION_DAYS]
  );
  total += c1 ?? 0;
  // outbox published
  const { rowCount: c2 } = await pool.query(
    `DELETE FROM outbox WHERE published_at IS NOT NULL AND published_at < NOW() - INTERVAL '1 day' * $1`,
    [RETENTION_DAYS]
  );
  total += c2 ?? 0;
  // eventos_recibidos (idempotency) — keep 30 days
  const { rowCount: c3 } = await pool.query(
    `DELETE FROM eventos_recibidos WHERE recibido_en < NOW() - INTERVAL '30 days'`
  );
  total += c3 ?? 0;

  if (total > 0) {
    console.log(`[retention:obs] deleted ${total} rows (retention ${RETENTION_DAYS}d)`);
    await pool.query("VACUUM (VERBOSE) event_log").catch(() => void 0);
  }
  return total;
}

let timer: NodeJS.Timeout | null = null;

export function startRetentionJob(): void {
  if (timer) return;
  // Run at startup after 10s, then every 24h
  setTimeout(
    () => void runRetention().catch((e) => console.error("[retention:obs] failed", e)),
    10_000
  );
  timer = setInterval(
    () => void runRetention().catch((e) => console.error("[retention:obs] failed", e)),
    24 * 60 * 60 * 1000
  );
  console.log(`[retention:obs] scheduled every 24h (retention ${RETENTION_DAYS}d)`);
}

export async function stopRetentionJob(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
