import pg from "pg";
import { generateProductos } from "./fixtures.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://productos_user:productos_pass@localhost:5433/productos_db";

async function seedLarge() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const productos = generateProductos(100, 42);
    console.log(`[seed:large] Insertando ${productos.length} productos...`);
    for (const p of productos) {
      await client.query(
        `INSERT INTO productos (id, sku, nombre, descripcion, precio, unidad, activo)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, precio = EXCLUDED.precio`,
        [p.id, p.sku, p.nombre, p.descripcion, p.precio, p.unidad]
      );
    }
    console.log(`[seed:large] ✓ ${productos.length} productos`);
  } finally {
    await client.end();
  }
}

seedLarge().catch((e) => {
  console.error("[seed:large] failed", e);
  process.exit(1);
});
