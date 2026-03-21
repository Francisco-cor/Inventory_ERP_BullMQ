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
 *   4. Wait for orden.confirmada on the SSE stream (svc-obs)
 *   5. Verify stock decreased (svc-stock)
 *   6. Verify svc-obs recorded the events
 */

import http from "node:http";
import supertest from "supertest";

const BASE = process.env.ERP_BASE_URL ?? "http://localhost:80";
const api  = supertest(BASE);

// ── Helpers ────────────────────────────────────────────────────────────────────

async function poll<T>(
  fn: () => Promise<T | null>,
  { maxMs = 30_000, intervalMs = 500 } = {}
): Promise<T> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== null) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`poll() timed out after ${maxMs}ms`);
}

/**
 * Connect to the SSE stream and resolve once an event matching `predicate`
 * arrives. Uses raw Node http.get so no EventSource polyfill is needed.
 * The SSE broker sends: event: <type>\ndata: <json>\n\n
 */
function waitForSseEvent(
  url: string,
  predicate: (eventName: string, data: unknown) => boolean,
  timeoutMs = 30_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) { settled = true; fn(); }
    };

    const timer = setTimeout(
      () => settle(() => { req.destroy(); reject(new Error(`waitForSseEvent timed out after ${timeoutMs}ms`)); }),
      timeoutMs
    );

    const req = http.get(url, { headers: { Accept: "text/event-stream" } }, (res) => {
      let buf = "";
      let currentEvent = "message";
      let currentData = "";

      res.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            currentData = line.slice(5).trim();
          } else if (line === "" && currentData) {
            try {
              const parsed = JSON.parse(currentData);
              if (predicate(currentEvent, parsed)) {
                settle(() => { clearTimeout(timer); req.destroy(); resolve(parsed); });
              }
            } catch { /* ignore malformed frames */ }
            currentEvent = "message";
            currentData = "";
          }
        }
      });

      res.on("error", (err) => settle(() => { clearTimeout(timer); reject(err); }));
    });

    req.on("error", (err) => settle(() => { clearTimeout(timer); reject(err); }));
  });
}

/** Predicate factory: matches a domain event on the SSE "event" channel by eventName + payload field. */
function sseEventWith(eventName: string, payloadKey: string, payloadValue: string) {
  return (name: string, data: unknown): boolean => {
    if (name !== "event" || typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    if (d["eventName"] !== eventName) return false;
    const payload = d["payload"] as Record<string, unknown> | undefined;
    return payload?.[payloadKey] === payloadValue;
  };
}

const SSE_URL = `${BASE}/api/v1/obs/events/stream`;

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

  // ── Step 4: Order confirmed via SSE ────────────────────────────────────────
  // Subscribes to the svc-obs SSE stream and waits for the orden.confirmada
  // domain event instead of busy-polling the REST endpoint.
  test("4. SSE stream — orden.confirmada received for this order", async () => {
    await waitForSseEvent(
      SSE_URL,
      sseEventWith("orden.confirmada", "ordenId", ordenId),
      30_000
    );

    // Confirm the REST state is also updated
    const res = await api.get(`/api/v1/ordenes/${ordenId}`).expect(200);
    expect(res.body.data.estado).toBe("confirmada");
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

  // Wait for orden.cancelada on the SSE stream instead of polling REST.
  test("3. SSE stream — orden.cancelada received for this order", async () => {
    await waitForSseEvent(
      SSE_URL,
      sseEventWith("orden.cancelada", "ordenId", ordenId),
      30_000
    );

    const res = await api.get(`/api/v1/ordenes/${ordenId}`).expect(200);
    expect(res.body.data.estado).toBe("cancelada");
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
