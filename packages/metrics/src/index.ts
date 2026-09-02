import client from "prom-client";
import type { FastifyInstance } from "fastify";

export interface ServiceMetrics {
  registry: client.Registry;
  httpRequestsTotal: client.Counter<string>;
  httpDuration: client.Histogram<string>;
  eventsPublished: client.Counter<string>;
  eventsConsumed: client.Counter<string>;
  eventsFailed: client.Counter<string>;
  outboxPending: client.Gauge<string>;
  outboxLag: client.Gauge<string>;
  sseClients: client.Gauge<string>;
  dbPoolTotal: client.Gauge<string>;
  dbPoolIdle: client.Gauge<string>;
  dbPoolWaiting: client.Gauge<string>;
  slaWarnings: client.Counter<string>;
  orderConfirmationLatency: client.Histogram<string>;
}

export function createMetrics(service: string): ServiceMetrics {
  const registry = new client.Registry();
  // Default Node.js metrics (process, nodejs)
  client.collectDefaultMetrics({ register: registry, prefix: `${service.replace(/-/g, "_")}_` });

  const httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total HTTP requests",
    labelNames: ["method", "route", "status", "service"] as const,
    registers: [registry],
  });

  const httpDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration",
    labelNames: ["method", "route", "status", "service"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const eventsPublished = new client.Counter({
    name: "events_published_total",
    help: "Events published via event bus",
    labelNames: ["event_name", "service"] as const,
    registers: [registry],
  });

  const eventsConsumed = new client.Counter({
    name: "events_consumed_total",
    help: "Events consumed via event bus",
    labelNames: ["event_name", "service"] as const,
    registers: [registry],
  });

  const eventsFailed = new client.Counter({
    name: "events_failed_total",
    help: "Events failed (DLQ)",
    labelNames: ["event_name", "service", "error_type"] as const,
    registers: [registry],
  });

  const outboxPending = new client.Gauge({
    name: "outbox_pending",
    help: "Pending outbox messages",
    labelNames: ["service"] as const,
    registers: [registry],
  });

  const outboxLag = new client.Gauge({
    name: "outbox_lag_seconds",
    help: "Age of oldest pending outbox message in seconds",
    labelNames: ["service"] as const,
    registers: [registry],
  });

  const sseClients = new client.Gauge({
    name: "sse_clients",
    help: "Connected SSE clients",
    labelNames: ["service"] as const,
    registers: [registry],
  });

  const dbPoolTotal = new client.Gauge({
    name: "db_pool_total",
    help: "DB pool total connections",
    labelNames: ["service"] as const,
    registers: [registry],
  });

  const dbPoolIdle = new client.Gauge({
    name: "db_pool_idle",
    help: "DB pool idle connections",
    labelNames: ["service"] as const,
    registers: [registry],
  });

  const dbPoolWaiting = new client.Gauge({
    name: "db_pool_waiting",
    help: "DB pool waiting requests",
    labelNames: ["service"] as const,
    registers: [registry],
  });

  const slaWarnings = new client.Counter({
    name: "sla_warnings_total",
    help: "SLA warnings generated",
    labelNames: ["service"] as const,
    registers: [registry],
  });

  const orderConfirmationLatency = new client.Histogram({
    name: "order_confirmation_latency_seconds",
    help: "Order confirmation latency (from created to confirmed/cancelled)",
    labelNames: ["service", "result"] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry],
  });

  return {
    registry,
    httpRequestsTotal,
    httpDuration,
    eventsPublished,
    eventsConsumed,
    eventsFailed,
    outboxPending,
    outboxLag,
    sseClients,
    dbPoolTotal,
    dbPoolIdle,
    dbPoolWaiting,
    slaWarnings,
    orderConfirmationLatency,
  };
}

/**
 * Registra hooks Fastify para métricas HTTP.
 * Debe llamarse antes de registrar rutas.
 */
export function registerHttpMetrics(
  app: FastifyInstance,
  service: string,
  metrics: ServiceMetrics
): void {
  app.addHook("onRequest", async (req) => {
    (req as any).__metricsStart = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (req, reply) => {
    const start = (req as any).__metricsStart as bigint | undefined;
    const durationSec = start ? Number(process.hrtime.bigint() - start) / 1e9 : 0;
    const route = (req.routeOptions?.url ?? req.url.split("?")[0]) || "unknown";
    const labels = {
      method: req.method,
      route,
      status: String(reply.statusCode),
      service,
    };
    metrics.httpRequestsTotal.inc(labels);
    metrics.httpDuration.observe(labels, durationSec);
  });
}

/**
 * Handler para GET /metrics (prometheus scrape).
 * Protegido opcionalmente por ADMIN_API_KEY en prod (se deja abierto para Prometheus interno).
 */
export function createMetricsHandler(metrics: ServiceMetrics) {
  return async (_req: any, reply: any) => {
    reply.header("Content-Type", metrics.registry.contentType);
    return reply.send(await metrics.registry.metrics());
  };
}

/**
 * Actualiza gauges de DB pool y outbox periódicamente.
 */
export function startMetricsUpdater(
  metrics: ServiceMetrics,
  service: string,
  getters: {
    getPoolMetrics?: () => { totalCount: number; idleCount: number; waitingCount: number };
    getOutboxPending?: () => Promise<number>;
    getOutboxLag?: () => Promise<number>;
    getSseClients?: () => number;
  },
  intervalMs = 5000
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      if (getters.getPoolMetrics) {
        const p = getters.getPoolMetrics();
        metrics.dbPoolTotal.set({ service }, p.totalCount);
        metrics.dbPoolIdle.set({ service }, p.idleCount);
        metrics.dbPoolWaiting.set({ service }, p.waitingCount);
      }
      if (getters.getOutboxPending) {
        const pending = await getters.getOutboxPending();
        metrics.outboxPending.set({ service }, pending);
      }
      if (getters.getOutboxLag) {
        const lag = await getters.getOutboxLag();
        metrics.outboxLag.set({ service }, lag);
      }
      if (getters.getSseClients) {
        metrics.sseClients.set({ service }, getters.getSseClients());
      }
    } catch {
      // ignore updater errors
    }
  }, intervalMs);
}
