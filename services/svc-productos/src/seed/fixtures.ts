/**
 * Fixtures realistas — 100 productos sintéticos + 1000 órdenes (large seed)
 * Uso: npm run seed:large --workspace=@erp/svc-productos
 * Determinístico (seed fija), idempotente ON CONFLICT
 */

const ADJETIVOS = ["Pro", "Ultra", "Eco", "Max", "Lite", "Prime", "Smart", "Turbo"];
const SUSTANTIVOS = ["Teclado", "Mouse", "Monitor", "Silla", "Hub", "Cable", "Webcam", "Auricular"];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function generateProductos(count = 100, seed = 42) {
  const rnd = seededRandom(seed);
  const productos = [];
  for (let i = 0; i < count; i++) {
    const adj = ADJETIVOS[Math.floor(rnd() * ADJETIVOS.length)];
    const sust = SUSTANTIVOS[Math.floor(rnd() * SUSTANTIVOS.length)];
    const sku = `SKU-LARGE-${String(i + 100).padStart(3, "0")}`;
    const precio = Math.round((10 + rnd() * 500) * 100) / 100;
    const id = `10000000-0000-4000-8000-${String(i + 1000).padStart(12, "0")}`;
    productos.push({
      id,
      sku,
      nombre: `${sust} ${adj} ${i + 1}`,
      precio,
      unidad: "pza",
      descripcion: `Producto sintético ${i + 1}`,
    });
  }
  return productos;
}

export function generateOrdenes(productoIds: string[], count = 200, seed = 99) {
  const rnd = seededRandom(seed);
  const ordenes = [];
  for (let i = 0; i < count; i++) {
    const productoId = productoIds[Math.floor(rnd() * productoIds.length)];
    const cantidad = Math.floor(1 + rnd() * 5);
    ordenes.push({
      productoId,
      cantidad,
      precioUnitario: Math.round((10 + rnd() * 100) * 100) / 100,
    });
  }
  return ordenes;
}
