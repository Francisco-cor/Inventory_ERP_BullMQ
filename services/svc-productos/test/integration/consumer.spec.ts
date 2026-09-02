import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

describe("svc-productos — idempotencia y outbox (testcontainers)", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const url = container.getConnectionUri();
    pool = new pg.Pool({ connectionString: url });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS outbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre_evento VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        correlation_id VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ,
        attempts INT NOT NULL DEFAULT 0
      );
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it("outbox insert + SELECT FOR UPDATE SKIP LOCKED", async () => {
    const id = "11111111-1111-4111-8111-111111111099";
    await pool.query(
      "INSERT INTO outbox (id, nombre_evento, payload) VALUES ($1,'producto.creado','{\"sku\":\"SKU-TEST\"}')",
      [id]
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT id FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
      );
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(id);
      await client.query("UPDATE outbox SET published_at=NOW() WHERE id=$1", [id]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const { rows } = await pool.query("SELECT published_at FROM outbox WHERE id=$1", [id]);
    expect(rows[0].published_at).not.toBeNull();
  });

  it("SKIP LOCKED permite concurrent relays sin duplicar", async () => {
    // Inserta 2 outbox pendientes
    await pool.query("DELETE FROM outbox");
    await pool.query(
      "INSERT INTO outbox (nombre_evento, payload) VALUES ('producto.creado','{\"a\":1}'), ('producto.creado','{\"a\":2}')"
    );
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      const r1 = await c1.query(
        "SELECT id FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
      );
      const r2 = await c2.query(
        "SELECT id FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
      );
      // Deben ser distintos ids (SKIP LOCKED evita bloqueo)
      expect(r1.rows[0].id).not.toBe(r2.rows[0].id);
      await c1.query("ROLLBACK");
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
  });
});
