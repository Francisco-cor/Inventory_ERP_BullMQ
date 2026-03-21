import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
});

export async function waitForDatabase(retries = 20, delayMs = 2000): Promise<void> {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log("[db] PostgreSQL ready");
      return;
    } catch {
      console.log(`[db] Waiting for PostgreSQL... (${i}/${retries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("PostgreSQL not available after retries");
}
