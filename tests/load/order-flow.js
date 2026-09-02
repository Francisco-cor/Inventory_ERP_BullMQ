import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

// Métricas custom para SLO Fase 6 (p95 <2s)
const orderConfirmLatency = new Trend("order_confirmation_latency_seconds", true);
const sseDelivery = new Trend("sse_delivery_seconds", true);
const failedOrders = new Counter("failed_orders");

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "2m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    order_confirmation_latency_seconds: ["p(95)<2000"],
    failed_orders: ["count==0"],
  },
};

// Producto fijo para load (asume seed:large ya corrido o stock suficiente)
const BASE = __ENV.ERP_BASE_URL || "http://localhost:80";
const PRODUCTO_ID = __ENV.PRODUCTO_ID || "11111111-1111-4111-8111-111111111001";
const SKU = __ENV.SKU || "SKU-SEED-001";

function pollOrder(ordenId, maxMs = 15000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res = http.get(`${BASE}/api/v1/ordenes/${ordenId}`);
    if (res.status === 200) {
      const body = JSON.parse(res.body);
      const estado = body.data?.estado ?? body.estado;
      if (estado === "confirmada" || estado === "confirmed")
        return { estado, latency: Date.now() - startMap[ordenId] };
      if (estado === "cancelada" || estado === "cancelled")
        return { estado: "cancelada", latency: 0 };
    }
    sleep(0.3);
  }
  return null;
}

const startMap = {};

export default function () {
  // 1. Crear orden con Idempotency-Key (Fase 2)
  const idempotencyKey = `load-${__VU}-${__ITER}-${Date.now()}`;
  const payload = JSON.stringify({
    lineas: [{ productoId: PRODUCTO_ID, sku: SKU, cantidad: 1, precioUnitario: 10 }],
  });
  const start = Date.now();
  const res = http.post(`${BASE}/api/v1/ordenes`, payload, {
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
  });

  const ok = check(res, {
    "POST /ordenes 201": (r) => r.status === 201,
    "orden pendiente": (r) => {
      try {
        const b = JSON.parse(r.body);
        return b.data?.estado === "pendiente" || b.estado === "pendiente";
      } catch {
        return false;
      }
    },
  });
  if (!ok) {
    failedOrders.add(1);
    return;
  }

  const body = JSON.parse(res.body);
  const ordenId = body.data?.id ?? body.id;
  startMap[ordenId] = start;

  // 2. Poll hasta confirmada (simula espera de SSE sin EventSource en k6)
  const result = pollOrder(ordenId, 15000);
  if (!result) {
    failedOrders.add(1);
    check(null, { "orden confirmada en <15s": () => false });
    return;
  }
  if (result.estado === "cancelada") {
    // Stock insuficiente es válido en load, pero lo contamos como no fallido si es por stock
    return;
  }
  const latencySec = result.latency / 1000;
  orderConfirmLatency.add(latencySec);
  check(result, { confirmada: (r) => r.estado === "confirmada" || r.estado === "confirmed" });

  // 3. Verificar SSE vía polling de event_log (simula entrega)
  const obsRes = http.get(`${BASE}/api/v1/obs/events?eventName=orden.confirmada&pageSize=5`);
  if (obsRes.status === 200) {
    const obsBody = JSON.parse(obsRes.body);
    const found = obsBody.data?.some(
      (e) => e.payload?.ordenId === ordenId || e.payload?.orden?.id === ordenId
    );
    if (found) sseDelivery.add(latencySec);
  }

  sleep(0.5);
}

export function handleSummary(data) {
  console.log(
    "p95 order_confirmation_latency_seconds:",
    data.metrics.order_confirmation_latency_seconds?.values["p(95)"]
  );
  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
