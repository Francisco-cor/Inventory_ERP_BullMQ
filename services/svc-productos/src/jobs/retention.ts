import { pool } from "../db/pool.js";

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);

export async function runRetention(): Promise<number> {
  const { rowCount: c1 } = await pool.query(
    `DELETE FROM eventos_emitidos WHERE emitido_en < NOW() - INTERVAL '1 day' * $1`,
    [RETENTION_DAYS]
  );
  const { rowCount: c2 } = await pool.query(
    `DELETE FROM outbox WHERE published_at IS NOT NULL AND published_at < NOW() - INTERVAL '1 day' * $1`,
    [RETENTION_DAYS]
  );
  const total = (c1 ?? 0) + (c2 ?? 0);
  if (total > 0) console.log(`[retention:productos] deleted ${total} rows`);
  return total;
}

let timer: NodeJS.Timeout | null = null;
export function startRetentionJob(): void {
  if (timer) return;
  setTimeout(() => void runRetention().catch(() => void 0), 10_000);
  timer = setInterval(() => void runRetention().catch(() => void 0), 24 * 60 * 60 * 1000);
  console.log(`[retention:productos] scheduled`);
}
export async function stopRetentionJob(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
