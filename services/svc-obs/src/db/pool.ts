import pg from "pg";
import { waitForWithJitter, CircuitBreaker } from "@erp/resilience";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000),
  idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TX_TIMEOUT_MS ?? 30000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 5000),
});

export const dbBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 10_000,
  halfOpenMaxCalls: 2,
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

export async function waitForDatabase(retries = 20, baseDelayMs = 500): Promise<void> {
  try {
    await waitForWithJitter(
      async () => {
        const client = await pool.connect();
        try {
          await client.query("SELECT 1");
        } finally {
          client.release();
        }
        console.log("[db] PostgreSQL ready");
      },
      retries,
      baseDelayMs,
      5000
    );
  } catch (err) {
    console.error("[db] PostgreSQL not available after retries", err);
    throw err;
  }
}

export function getPoolMetrics() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    breakerState: dbBreaker.getState(),
  };
}
