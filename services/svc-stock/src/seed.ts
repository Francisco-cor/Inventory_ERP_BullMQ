import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://stock_user:stock_pass@localhost:5435/stock_db";

// Debe coincidir con los IDs de svc-productos/src/seed.ts
const SEED_STOCK = [
  {
    producto_id: "11111111-1111-4111-8111-111111111001",
    sku: "SKU-SEED-001",
    disponible: 100,
    reservado: 0,
  },
  {
    producto_id: "11111111-1111-4111-8111-111111111002",
    sku: "SKU-SEED-002",
    disponible: 50,
    reservado: 0,
  },
  {
    producto_id: "11111111-1111-4111-8111-111111111003",
    sku: "SKU-SEED-003",
    disponible: 15,
    reservado: 0,
  },
  {
    producto_id: "11111111-1111-4111-8111-111111111004",
    sku: "SKU-SEED-004",
    disponible: 8,
    reservado: 0,
  },
  {
    producto_id: "11111111-1111-4111-8111-111111111005",
    sku: "SKU-SEED-005",
    disponible: 120,
    reservado: 0,
  },
] as const;

async function seed() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    console.log("[seed:stock] Conectado a", DATABASE_URL.replace(/:.*@/, ":***@"));
    for (const s of SEED_STOCK) {
      await client.query(
        `INSERT INTO stock (producto_id, sku, disponible, reservado)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (producto_id) DO UPDATE SET
           sku = EXCLUDED.sku,
           disponible = EXCLUDED.disponible,
           reservado = EXCLUDED.reservado,
           actualizado_en = NOW()`,
        [s.producto_id, s.sku, s.disponible, s.reservado]
      );
      // Registra movimiento de ajuste inicial (idempotente: borra previos seed y reinserta)
      await client.query(
        `DELETE FROM movimientos_stock WHERE producto_id = $1 AND motivo = 'seed inicial'`,
        [s.producto_id]
      );
      await client.query(
        `INSERT INTO movimientos_stock (producto_id, tipo, delta, motivo)
         VALUES ($1, 'ajuste', $2, 'seed inicial')`,
        [s.producto_id, s.disponible]
      );
      // Limpia alertas previas del seed para estado limpio
      await client.query(`DELETE FROM alertas_stock WHERE producto_id = $1`, [s.producto_id]);
      console.log(`[seed:stock] ✓ ${s.sku} disponible=${s.disponible}`);
    }
    console.log(`[seed:stock] ${SEED_STOCK.length} filas de stock seeded`);
    // Verifica alertas: productos con disponible < umbral (10) deberían generar alerta si se usa el flujo normal,
    // pero el seed directo no dispara eventos; el estado es intencionalmente limpio para tests determinísticos.
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error("[seed:stock] failed:", err);
  process.exit(1);
});
