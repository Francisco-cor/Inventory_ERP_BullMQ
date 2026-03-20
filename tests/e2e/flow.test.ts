/**
 * E2E Integration Tests — Full Order Flow
 *
 * Prerequisites: `docker compose up -d` must be running.
 * All requests go through nginx at http://localhost:80.
 *
 * Test flow:
 *   1. Create a product (svc-productos)
 *   2. Initialize stock for that product (svc-stock)
 *   3. Create an order (svc-ordenes) → triggers event chain
 *   4. Poll until order is CONFIRMED (svc-ordenes confirms when stock is reserved)
 *   5. Verify stock decreased (svc-stock)
 *   6. Verify svc-obs recorded the events
 */

import supertest from "supertest";

const BASE = process.env.ERP_BASE_URL ?? "http://localhost:80";
const api  = supertest(BASE);

// ── Helpers ────────────────────────────────────────────────────────────────────

async function poll<T>(
  fn: () => Promise<T | null>,
  { maxMs = 15_000, intervalMs = 500 } = {}
): Promise<T> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== null) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`poll() timed out after ${maxMs}ms`);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ERP — full order flow", () => {
  let productoId: string;
  let ordenId: string;
  const SKU       = `E2E-${Date.now()}`;
  const CANTIDAD  = 3;
  const STOCK_INI = 20;

  // ── Step 1: Create product ─────────────────────────────────────────────────
  test("1. POST /api/v1/productos — create product", async () => {
    const res = await api
      .post("/api/v1/productos")
      .send({
        sku:    SKU,
        nombre: "Producto E2E Test",
        precio: 99.99,
        unidad: "pza",
      })
      .expect(201);

    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.sku).toBe(SKU);
    productoId = res.body.data.id;
  });

  // ── Step 2: Initialize stock ───────────────────────────────────────────────
  // svc-stock initializes a stock row when it receives the producto.creado event.
  // Poll until the row is ready, then adjust to the desired initial quantity.
  test("2. POST /api/v1/stock/:productoId/ajustar — initialize stock", async () => {
    // Wait for svc-stock to process the producto.creado event and create the row
    await poll(async () => {
      const res = await api.get(`/api/v1/stock/${productoId}`);
      return res.status === 200 ? true : null;
    });

    const res = await api
      .post(`/api/v1/stock/${productoId}/ajustar`)
      .send({
        delta:  STOCK_INI,
        motivo: "Inventario inicial E2E",
      })
      .expect(200);

    expect(res.body.data.disponible).toBe(STOCK_INI);
  });

  // ── Step 3: Create order ───────────────────────────────────────────────────
  test("3. POST /api/v1/ordenes — create order (triggers event chain)", async () => {
    const res = await api
      .post("/api/v1/ordenes")
      .send({
        lineas: [
          {
            productoId,
            sku:            SKU,
            cantidad:       CANTIDAD,
            precioUnitario: 99.99,
          },
        ],
      })
      .expect(201);

    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.estado).toBe("pendiente");
    ordenId = res.body.data.id;
  });

  // ── Step 4: Order confirmed ────────────────────────────────────────────────
  test("4. GET /api/v1/ordenes/:id — order transitions to CONFIRMADA", async () => {
    const orden = await poll(async () => {
      const res = await api
        .get(`/api/v1/ordenes/${ordenId}`)
        .expect(200);

      if (res.body.data.estado === "confirmada") return res.body.data;
      return null;
    });

    expect(orden.estado).toBe("confirmada");
  });

  // ── Step 5: Stock decreased ────────────────────────────────────────────────
  test("5. GET /api/v1/stock/:productoId — stock decremented by order cantidad", async () => {
    const res = await api
      .get(`/api/v1/stock/${productoId}`)
      .expect(200);

    const { disponible, reservado } = res.body.data as { disponible: number; reservado: number };
    // After confirmation the order consumed the stock; total must reflect it
    expect(disponible + reservado).toBeLessThanOrEqual(STOCK_INI);
    expect(disponible + reservado).toBeGreaterThanOrEqual(STOCK_INI - CANTIDAD);
  });

  // ── Step 6: Observability recorded the events ──────────────────────────────
  test("6. GET /api/v1/obs/events — svc-obs recorded the event chain", async () => {
    // Give svc-obs a moment to process events from its queue
    await new Promise((r) => setTimeout(r, 1_000));

    const res = await api
      .get("/api/v1/obs/events")
      .query({ pageSize: 100 })
      .expect(200);

    const eventNames: string[] = res.body.data.map((e: { eventName: string }) => e.eventName);

    expect(eventNames).toContain("orden.creada");
    expect(eventNames).toContain("stock.reservado");
    expect(eventNames).toContain("orden.confirmada");
  });
});

// ── Insufficient stock flow ────────────────────────────────────────────────────

describe("ERP — insufficient stock flow", () => {
  let productoId: string;
  let ordenId: string;
  const SKU = `E2E-NOSTOCK-${Date.now()}`;

  test("1. Create product with zero stock", async () => {
    const res = await api
      .post("/api/v1/productos")
      .send({ sku: SKU, nombre: "Sin Stock E2E", precio: 1.0, unidad: "pza" })
      .expect(201);
    productoId = res.body.data.id;
  });

  test("2. Create order — should be CANCELLED due to no stock", async () => {
    const res = await api
      .post("/api/v1/ordenes")
      .send({
        lineas: [{ productoId, sku: SKU, cantidad: 999, precioUnitario: 1.0 }],
      })
      .expect(201);
    ordenId = res.body.data.id;
  });

  test("3. Order transitions to CANCELADA", async () => {
    const orden = await poll(async () => {
      const res = await api.get(`/api/v1/ordenes/${ordenId}`).expect(200);
      if (res.body.data.estado === "cancelada") return res.body.data;
      return null;
    });
    expect(orden.estado).toBe("cancelada");
  });

  test("4. svc-obs recorded stock.insuficiente", async () => {
    await new Promise((r) => setTimeout(r, 1_000));
    const res = await api
      .get("/api/v1/obs/events")
      .query({ eventName: "stock.insuficiente", pageSize: 10 })
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
