import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000),
  idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TX_TIMEOUT_MS ?? 30000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 5000),
});

pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle client:", err);
});

pool.on("connect", (client) => {
  void client.query(
    `SET statement_timeout = '${Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000)}'`
  );
  void client.query(
    `SET idle_in_transaction_session_timeout = '${Number(process.env.DB_IDLE_TX_TIMEOUT_MS ?? 30000)}'`
  );
});

export async function waitForDatabase(retries = 10, delayMs = 2000): Promise<void> {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log("[db] Connection established");
      return;
    } catch (err) {
      console.warn(`[db] Connection attempt ${i}/${retries} failed. Retrying in ${delayMs}ms...`);
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export function getPoolMetrics() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}
