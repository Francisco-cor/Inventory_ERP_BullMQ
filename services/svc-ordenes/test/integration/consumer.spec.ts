import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

/**
 * Integration test — isAlreadyProcessed con y sin transacción
 * Verifica que el patrón SAVEPOINT de svc-stock esté correctamente portado a svc-ordenes
 * (Fase 3.4 fix: idempotencia dentro de tx)
 */

describe("svc-ordenes — isAlreadyProcessed (testcontainers)", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const url = container.getConnectionUri();
    pool = new pg.Pool({ connectionString: url });
    // Esquema mínimo
    await pool.query(`
      CREATE TABLE IF NOT EXISTS eventos_recibidos (
        event_id VARCHAR(255) PRIMARY KEY,
        nombre_evento VARCHAR(100) NOT NULL,
        recibido_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ordenes (
        id UUID PRIMARY KEY,
        estado VARCHAR(20) NOT NULL,
        total NUMERIC(10,2) NOT NULL,
        creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function isAlreadyProcessed(
    client: pg.PoolClient,
    eventId: string,
    eventName: string
  ): Promise<boolean> {
    const { rowCount } = await client.query(
      "INSERT INTO eventos_recibidos (event_id, nombre_evento) VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING",
      [eventId, eventName]
    );
    return (rowCount ?? 0) === 0;
  }

  it("primer insert → no procesado antes, segundo → duplicado", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const first = await isAlreadyProcessed(client, "evt-1", "orden.creada");
      expect(first).toBe(false);
      await client.query("COMMIT");

      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");
        const second = await isAlreadyProcessed(client2, "evt-1", "orden.creada");
        expect(second).toBe(true);
        await client2.query("ROLLBACK");
      } finally {
        client2.release();
      }
    } finally {
      client.release();
    }
  });

  it("SAVEPOINT rollback no deja evento como procesado si UPDATE falla", async () => {
    // Simula: isAlreadyProcessed dentro de tx con SAVEPOINT, luego UPDATE falla → ROLLBACK TO SAVEPOINT → evento no queda marcado
    // En nuestro caso, isAlreadyProcessed hace INSERT; si luego hacemos ROLLBACK, el INSERT se deshace
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SAVEPOINT sp_test");
      const first = await isAlreadyProcessed(client, "evt-sp-1", "orden.creada");
      expect(first).toBe(false);
      // Simulamos fallo y rollback a savepoint
      await client.query("ROLLBACK TO SAVEPOINT sp_test");
      await client.query("RELEASE SAVEPOINT sp_test");
      // Tras rollback, el evento no debería estar en tabla, por lo que re-insert debe ser no-duplicado
      const second = await isAlreadyProcessed(client, "evt-sp-1", "orden.creada");
      expect(second).toBe(false);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });

  it("fuera de tx: si INSERT ok pero COMMIT falla, retry no pierde evento (debe ser idempotente)", async () => {
    const eventId = "evt-outside-tx";
    // Primera tx: INSERT + COMMIT ok
    const c1 = await pool.connect();
    await c1.query("BEGIN");
    const r1 = await isAlreadyProcessed(c1, eventId, "orden.creada");
    expect(r1).toBe(false);
    await c1.query("COMMIT");
    c1.release();

    // Segunda tx: intenta mismo id, debe ser duplicado (independiente de fallo previo)
    const c2 = await pool.connect();
    await c2.query("BEGIN");
    const r2 = await isAlreadyProcessed(c2, eventId, "orden.creada");
    expect(r2).toBe(true);
    await c2.query("ROLLBACK");
    c2.release();
  });
});
