import pg from "pg";
import { randomUUID } from "node:crypto";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://ordenes_user:ordenes_pass@localhost:5434/ordenes_db";

// Reuse product IDs from svc-productos large seeds (SKU-LARGE-100..199)
// IDs are deterministic: 10000000-0000-4000-8000-<1000+padded>
function generateProductoIds(count = 100): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(`10000000-0000-4000-8000-${String(i + 1000).padStart(12, "0")}`);
  }
  return ids;
}

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

async function seedLarge() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const productoIds = generateProductoIds(100);
    const rnd = seededRandom(99);
    const count = 200;
    console.log(`[seed:large:ordenes] Insertando ${count} órdenes sintéticas...`);
    for (let i = 0; i < count; i++) {
      const productoId = productoIds[Math.floor(rnd() * productoIds.length)];
      const cantidad = Math.floor(1 + rnd() * 5);
      const precioUnitario = Math.round((10 + rnd() * 100) * 100) / 100;
      const ordenId = randomUUID();
      await client.query("BEGIN");
      try {
        await client.query(`INSERT INTO ordenes (id, estado, total) VALUES ($1, 'pendiente', $2)`, [
          ordenId,
          cantidad * precioUnitario,
        ]);
        await client.query(
          `INSERT INTO lineas_orden (id, orden_id, producto_id, sku, cantidad, precio_unitario)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            ordenId,
            productoId,
            `SKU-LARGE-${productoId.slice(-3)}`,
            cantidad,
            precioUnitario,
          ]
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      }
    }
    console.log(
      `[seed:large:ordenes] ✓ ${count} órdenes (estado=pendiente, sin eventos — para inspección/load)`
    );
    console.log(
      "[seed:large:ordenes] Para flujo completo con eventos, usar POST /api/v1/ordenes o k6 load test"
    );
  } finally {
    await client.end();
  }
}

seedLarge().catch((e) => {
  console.error("[seed:large:ordenes] failed", e);
  process.exit(1);
});
