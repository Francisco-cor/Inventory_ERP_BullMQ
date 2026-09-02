import type { FastifyInstance } from "fastify";
import { pool, getPoolMetrics } from "../db/pool.js";
import { eventBus } from "../events/bus.js";
import { clientCount, getSseAdapter } from "../sse/broker.js";
import { isShuttingDown } from "../state.js";

const SERVICE_URLS: Record<string, string> = {
  "svc-productos": process.env.PRODUCTOS_HEALTH_URL ?? "http://svc-productos:3001/health",
  "svc-ordenes": process.env.ORDENES_HEALTH_URL ?? "http://svc-ordenes:3002/health",
  "svc-stock": process.env.STOCK_HEALTH_URL ?? "http://svc-stock:3003/health",
  "svc-obs": "self",
};

async function fetchWithTimeout(
  url: string,
  ms = 2000
): Promise<{ status: string; httpCode?: number; ms: number }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return { status: r.ok ? "ok" : "error", httpCode: r.status, ms: Date.now() - start };
  } catch {
    return { status: "error", ms: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

export async function aggregateHealthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness agregado — consulta paralelo a cada servicio
  app.get("/health/aggregate", async (_req, reply) => {
    const start = Date.now();

    // Self checks promise
    const selfDb = pool
      .query("SELECT 1")
      .then(() => "ok")
      .catch(() => "error");
    const selfRedis = eventBus
      .ping()
      .then(() => "ok")
      .catch(() => "error");

    const [dbStatus, redisStatus, ...other] = await Promise.all([
      selfDb,
      selfRedis,
      ...Object.entries(SERVICE_URLS)
        .filter(([k]) => k !== "svc-obs")
        .map(async ([name, url]) => {
          const res = await fetchWithTimeout(
            url,
            Number(process.env.HEALTH_AGGREGATE_TIMEOUT_MS ?? 2000)
          );
          return { name, ...res };
        }),
    ]);

    // other contains array of {name,status,...}
    const services: Record<string, unknown> = {
      "svc-obs": {
        status: dbStatus === "ok" && redisStatus === "ok" ? "ok" : "error",
        db: dbStatus,
        redis: redisStatus,
        sseClients: clientCount(),
        sseAdapter: getSseAdapter(),
        pool: getPoolMetrics(),
      },
    };
    for (const o of other as Array<{
      name: string;
      status: string;
      httpCode?: number;
      ms: number;
    }>) {
      services[o.name] = { status: o.status, httpCode: o.httpCode, latencyMs: o.ms };
    }

    const allOk =
      Object.values(services).every((s) => (s as { status: string }).status === "ok") &&
      !isShuttingDown;
    const code = allOk ? 200 : 503;
    return reply.status(code).send({
      status: allOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      isShuttingDown,
      latencyMs: Date.now() - start,
      services,
    });
  });

  // Readiness — solo self (para K8s readinessProbe). 200 solo si DB+Redis ok y no draining
  app.get("/health/ready", async (_req, reply) => {
    if (isShuttingDown) return reply.status(503).send({ status: "draining", isShuttingDown: true });
    try {
      await pool.query("SELECT 1");
    } catch {
      return reply.status(503).send({ status: "error", reason: "db" });
    }
    try {
      await eventBus.ping();
    } catch {
      return reply.status(503).send({ status: "error", reason: "redis" });
    }
    return reply.send({ status: "ok", sseAdapter: getSseAdapter(), pool: getPoolMetrics() });
  });

  // Liveness simple (alias a /health pero sin fan-out)
  app.get("/health/live", async (_req, reply) => {
    return reply.send({
      status: isShuttingDown ? "draining" : "ok",
      uptime: process.uptime(),
      isShuttingDown,
    });
  });
}
