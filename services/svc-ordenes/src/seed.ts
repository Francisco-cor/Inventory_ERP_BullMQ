import pg from "pg";
import { randomUUID } from "node:crypto";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://ordenes_user:ordenes_pass@localhost:5434/ordenes_db";

// Orden determinística de ejemplo para probar SLA y flujo.
// Solo se inserta si no existe ninguna orden con el SKU seed (idempotente por sku en línea).
const SEED_ORDEN_ID = "22222222-2222-4222-8222-222222222001";
const SEED_PRODUCTO_ID = "11111111-1111-4111-8111-111111111001";
const SEED_SKU = "SKU-SEED-001";

async function seed() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    console.log("[seed:ordenes] Conectado a", DATABASE_URL.replace(/:.*@/, ":***@"));

    // Verifica si la orden seed ya existe
    const { rows } = await client.query("SELECT id FROM ordenes WHERE id = $1", [SEED_ORDEN_ID]);
    if (rows.length > 0) {
      console.log(`[seed:ordenes] ✓ Orden ${SEED_ORDEN_ID} ya existe — skip`);
      return;
    }

    await client.query("BEGIN");

    await client.query(`INSERT INTO ordenes (id, estado, total) VALUES ($1, 'pendiente', $2)`, [
      SEED_ORDEN_ID,
      89.99 * 2,
    ]);

    await client.query(
      `INSERT INTO lineas_orden (id, orden_id, producto_id, sku, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), SEED_ORDEN_ID, SEED_PRODUCTO_ID, SEED_SKU, 2, 89.99]
    );

    await client.query("COMMIT");
    console.log(`[seed:ordenes] ✓ Orden ${SEED_ORDEN_ID} (2x ${SEED_SKU}) estado=pendiente`);
    console.log(
      "[seed:ordenes] Nota: esta orden no emite evento al seed; solo para inspección local."
    );
    console.log("[seed:ordenes] Para flujo completo, crear orden via POST /api/v1/ordenes");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error("[seed:ordenes] failed:", err);
  process.exit(1);
});
