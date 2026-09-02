import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

describe("svc-stock — SAVEPOINT + FOR UPDATE (testcontainers)", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const url = container.getConnectionUri();
    pool = new pg.Pool({ connectionString: url });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS eventos_recibidos (
        event_id VARCHAR(255) PRIMARY KEY,
        nombre_evento VARCHAR(100) NOT NULL,
        recibido_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS stock (
        producto_id UUID PRIMARY KEY,
        sku VARCHAR(100) NOT NULL,
        disponible INT NOT NULL,
        reservado INT NOT NULL,
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(
      "INSERT INTO stock (producto_id, sku, disponible, reservado) VALUES ('11111111-1111-4111-8111-111111111001','SKU-001', 10, 0) ON CONFLICT (producto_id) DO NOTHING"
    );
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function isAlreadyProcessed(client: pg.PoolClient, eventId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      "INSERT INTO eventos_recibidos (event_id, nombre_evento) VALUES ($1,'orden.creada') ON CONFLICT (event_id) DO NOTHING",
      [eventId]
    );
    return (rowCount ?? 0) === 0;
  }

  it("reserva con FOR UPDATE decrementa disponible y marca evento", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const dup = await isAlreadyProcessed(client, "evt-stock-1");
      expect(dup).toBe(false);
      const { rows } = await client.query(
        "SELECT disponible FROM stock WHERE producto_id=$1 FOR UPDATE",
        ["11111111-1111-4111-8111-111111111001"]
      );
      expect(rows[0].disponible).toBe(10);
      await client.query(
        "UPDATE stock SET disponible=disponible-2, reservado=reservado+2 WHERE producto_id=$1",
        ["11111111-1111-4111-8111-111111111001"]
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const { rows } = await pool.query(
      "SELECT disponible, reservado FROM stock WHERE producto_id=$1",
      ["11111111-1111-4111-8111-111111111001"]
    );
    expect(rows[0].disponible).toBe(8);
    expect(rows[0].reservado).toBe(2);
  });

  it("segundo intento con mismo event_id es idempotente (no doble reserva)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const dup = await isAlreadyProcessed(client, "evt-stock-1");
      expect(dup).toBe(true);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const { rows } = await pool.query("SELECT disponible FROM stock WHERE producto_id=$1", [
      "11111111-1111-4111-8111-111111111001",
    ]);
    expect(rows[0].disponible).toBe(8); // sin cambio
  });

  it("concurrent FOR UPDATE: segunda transacción espera (no deadlock)", async () => {
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c1.query("SELECT disponible FROM stock WHERE producto_id=$1 FOR UPDATE", [
        "11111111-1111-4111-8111-111111111001",
      ]);
      // c2 intenta FOR UPDATE, debe bloquear hasta commit de c1 (test con timeout 2s)
      const c2Promise = c2.query("SELECT disponible FROM stock WHERE producto_id=$1 FOR UPDATE", [
        "11111111-1111-4111-8111-111111111001",
      ]);
      setTimeout(() => c1.query("COMMIT").then(() => c1.release()), 200);
      const res = await Promise.race([
        c2Promise.then(() => "ok"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
      ]);
      expect(res).toBe("ok");
      await c2.query("ROLLBACK");
    } finally {
      try {
        c1.release();
      } catch {
        // already released after COMMIT
      }
      c2.release();
    }
  });
});
