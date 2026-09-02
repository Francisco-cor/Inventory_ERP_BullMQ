import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const contentionErrors = new Counter("contention_errors");
const adjustLatency = new Trend("stock_adjust_latency_seconds", true);

export const options = {
  scenarios: {
    contention: {
      executor: "constant-vus",
      vus: 100,
      duration: "1m",
      gracefulStop: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<300"],
  },
};

const BASE = __ENV.ERP_BASE_URL || "http://localhost:80";
const PRODUCTO_ID = __ENV.PRODUCTO_ID || "11111111-1111-4111-8111-111111111001";

export default function () {
  const delta = Math.random() > 0.5 ? 1 : -1;
  const start = Date.now();
  const res = http.post(
    `${BASE}/api/v1/stock/${PRODUCTO_ID}/ajustar`,
    JSON.stringify({ delta, motivo: `k6 contention vu=${__VU} iter=${__ITER}` }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );

  const latency = (Date.now() - start) / 1000;
  adjustLatency.add(latency);

  const ok = check(res, {
    "POST /ajustar 200": (r) => r.status === 200,
    "disponible es número": (r) => {
      try {
        const b = JSON.parse(r.body);
        return typeof b.data?.disponible === "number";
      } catch {
        return false;
      }
    },
  });
  if (!ok) contentionErrors.add(1);
  sleep(0.1);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(
      {
        vus: data.metrics.vus?.values,
        http_req_duration_p95: data.metrics.http_req_duration?.values["p(95)"],
        contention_errors: data.metrics.contention_errors?.values.count,
      },
      null,
      2
    ),
  };
}
