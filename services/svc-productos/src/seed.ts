import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://productos_user:productos_pass@localhost:5433/productos_db";

const SEED_PRODUCTOS = [
  {
    id: "11111111-1111-4111-8111-111111111001",
    sku: "SKU-SEED-001",
    nombre: "Teclado Mecánico RGB",
    descripcion: "Teclado mecánico switches brown, retroiluminado",
    precio: 89.99,
    unidad: "pza",
  },
  {
    id: "11111111-1111-4111-8111-111111111002",
    sku: "SKU-SEED-002",
    nombre: "Mouse Inalámbrico",
    descripcion: "Mouse ergonómico 16000 DPI",
    precio: 49.5,
    unidad: "pza",
  },
  {
    id: "11111111-1111-4111-8111-111111111003",
    sku: "SKU-SEED-003",
    nombre: 'Monitor 27" 144Hz',
    descripcion: "Panel IPS 27 pulgadas 144Hz",
    precio: 299.0,
    unidad: "pza",
  },
  {
    id: "11111111-1111-4111-8111-111111111004",
    sku: "SKU-SEED-004",
    nombre: "Silla Ergonómica",
    descripcion: "Silla malla transpirable con soporte lumbar",
    precio: 199.99,
    unidad: "pza",
  },
  {
    id: "11111111-1111-4111-8111-111111111005",
    sku: "SKU-SEED-005",
    nombre: "Hub USB-C 7 en 1",
    descripcion: "Hub con HDMI, USB3, PD 100W",
    precio: 39.99,
    unidad: "pza",
  },
] as const;

async function seed() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    console.log("[seed:productos] Conectado a", DATABASE_URL.replace(/:.*@/, ":***@"));
    for (const p of SEED_PRODUCTOS) {
      await client.query(
        `INSERT INTO productos (id, sku, nombre, descripcion, precio, unidad, activo)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (id) DO UPDATE SET
           sku = EXCLUDED.sku,
           nombre = EXCLUDED.nombre,
           descripcion = EXCLUDED.descripcion,
           precio = EXCLUDED.precio,
           unidad = EXCLUDED.unidad,
           activo = true`,
        [p.id, p.sku, p.nombre, p.descripcion, p.precio, p.unidad]
      );
      console.log(`[seed:productos] ✓ ${p.sku} — ${p.nombre}`);
    }
    console.log(`[seed:productos] ${SEED_PRODUCTOS.length} productos seeded (idempotente)`);
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error("[seed:productos] failed:", err);
  process.exit(1);
});
