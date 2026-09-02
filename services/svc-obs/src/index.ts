import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import pg from "pg";
import { registerSecurity } from "@erp/auth";
import { pool, waitForDatabase, getPoolMetrics } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { healthRoutes } from "./routes/health.js";
import { aggregateHealthRoutes } from "./routes/health-aggregate.js";
import { obsRoutes } from "./routes/obs.js";
import { adminRoutes } from "./routes/admin.js";
import { startEventConsumer } from "./events/consumer.js";
import { eventBus } from "./events/bus.js";
import { startOutboxRelay, stopOutboxRelay } from "./jobs/outbox-relay.js";
import { startRetentionJob, stopRetentionJob } from "./jobs/retention.js";
import { startSlaChecker, stopSlaChecker } from "./jobs/sla-checker.js";
import { initSseBroker, closeSseBroker, clientCount } from "./sse/broker.js";
import { randomUUID } from "node:crypto";
import { isShuttingDown as _isShuttingDown, setShuttingDown } from "./state.js";
import { createLogger, correlationStore } from "@erp/logger";
import {
  createMetrics,
  registerHttpMetrics,
  createMetricsHandler,
  startMetricsUpdater,
} from "@erp/metrics";
import { initTracing, shutdownTracing } from "@erp/tracing";

const PORT = Number(process.env.PORT ?? 3004);
const HOST = process.env.HOST ?? "0.0.0.0";
const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);

const logger = createLogger({ service: "svc-obs" });
const metrics = createMetrics("svc-obs");

const app = Fastify({ logger });

let metricsUpdater: NodeJS.Timeout | null = null;

async function bootstrap(): Promise<void> {
  await initTracing("svc-obs");
  await waitForDatabase();

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await runMigrations(client);
  } finally {
    await client.end();
  }

  await initSseBroker({ host: REDIS_HOST, port: REDIS_PORT });

  // Correlation hook (must be before other hooks)
  app.addHook("onRequest", async (request, reply) => {
    const headers = request.headers as Record<string, string>;
    const correlationId =
      (headers["x-correlation-id"] as string) ?? (headers["x-request-id"] as string) ?? undefined;
    const requestId = (headers["x-request-id"] as string) ?? correlationId;
    const ctx = {
      correlationId: correlationId ?? randomUUID(),
      requestId: requestId ?? correlationId ?? randomUUID(),
    };
    (correlationStore as any).enterWith?.(ctx);
    (request as any).correlationId = ctx.correlationId;
    (request as any).requestId = ctx.requestId;
    reply.header("X-Correlation-Id", ctx.correlationId);
    reply.header("X-Request-Id", ctx.requestId);
  });

  // HTTP metrics (must be before routes)
  registerHttpMetrics(app, "svc-obs", metrics);

  // Prometheus /metrics (exposed without auth for scraper)
  app.get("/metrics", createMetricsHandler(metrics));

  await registerSecurity(app);

  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, context) => ({
      error: "TooManyRequests",
      message: `Demasiadas peticiones. Máximo ${context.max} por minuto.`,
      statusCode: 429,
      timestamp: new Date().toISOString(),
    }),
  });

  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    return reply.status(500).send({
      error: "InternalServerError",
      message: "Error interno del servidor",
      statusCode: 500,
      timestamp: new Date().toISOString(),
    });
  });

  await app.register(healthRoutes);
  await app.register(aggregateHealthRoutes);
  await app.register(obsRoutes, { prefix: "/api/v1/obs" });
  await app.register(adminRoutes, { prefix: "/admin" });

  try {
    const { createBullBoard } = await import("@bull-board/api");
    const { BullMQAdapter } = await import("@bull-board/api/bullMQAdapter");
    const { FastifyAdapter } = await import("@bull-board/fastify");
    const { Queue } = await import("bullmq");
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath("/admin/queues");
    const q = new Queue("events-svc-obs", {
      connection: {
        host: process.env.REDIS_HOST ?? "redis",
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    });
    createBullBoard({ queues: [new BullMQAdapter(q)], serverAdapter });
    await app.register(serverAdapter.registerPlugin(), { prefix: "/admin/queues" });
    app.log.info("Bull Board registered at /admin/queues");
  } catch (e) {
    app.log.warn({ err: e }, "Bull Board not available");
  }

  startEventConsumer();
  startOutboxRelay();
  startRetentionJob();
  await startSlaChecker({ host: REDIS_HOST, port: REDIS_PORT });

  // Metrics updater (pool, outbox, SSE)
  metricsUpdater = startMetricsUpdater(metrics, "svc-obs", {
    getPoolMetrics,
    getOutboxPending: async () => {
      try {
        const { rows } = await pool.query(
          "SELECT COUNT(*)::int AS pending FROM outbox WHERE published_at IS NULL"
        );
        return rows[0].pending as number;
      } catch {
        return 0;
      }
    },
    getOutboxLag: async () => {
      try {
        const { rows } = await pool.query(
          "SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int AS lag FROM outbox WHERE published_at IS NULL"
        );
        return (rows[0].lag as number) ?? 0;
      } catch {
        return 0;
      }
    },
    getSseClients: () => clientCount(),
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`svc-obs listening on http://${HOST}:${PORT}`);
  app.log.info(
    `SSE stream: http://${HOST}:${PORT}/api/v1/obs/events/stream SSE adapter=${process.env.SSE_ADAPTER ?? "memory"}`
  );
  app.log.info(`Metrics: http://${HOST}:${PORT}/metrics`);
}

bootstrap().catch((err) => {
  logger.error({ err }, "[fatal] Failed to start svc-obs");
  process.exit(1);
});

async function gracefulShutdown(signal: string): Promise<void> {
  if (_isShuttingDown) return;
  setShuttingDown(true);
  logger.info(`[shutdown] ${signal} received — draining (10s timeout)`);
  const timeout = setTimeout(() => {
    logger.error("[shutdown] forced exit after 10s");
    process.exit(1);
  }, 10_000);
  timeout.unref?.();

  try {
    if (metricsUpdater) clearInterval(metricsUpdater);
    await stopSlaChecker().catch((e) => logger.error({ err: e }, "[shutdown] stopSlaChecker"));
    await stopOutboxRelay().catch((e) => logger.error({ err: e }, "[shutdown] stopOutboxRelay"));
    await stopRetentionJob().catch((e) => logger.error({ err: e }, "[shutdown] stopRetentionJob"));
    await closeSseBroker().catch((e) => logger.error({ err: e }, "[shutdown] closeSseBroker"));
    try {
      await app.close();
    } catch (e) {
      logger.error({ err: e }, "[shutdown] app.close");
    }
    try {
      const server = app.server as unknown as {
        closeAllConnections?: () => void;
        closeIdleConnections?: () => void;
      };
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
    } catch {
      void 0;
    }
    await eventBus.close().catch((e) => logger.error({ err: e }, "[shutdown] eventBus.close"));
    await shutdownTracing().catch((e) => logger.error({ err: e }, "[shutdown] tracing"));
    await pool.end().catch((e) => logger.error({ err: e }, "[shutdown] pool.end"));
    logger.info("[shutdown] graceful exit");
    clearTimeout(timeout);
    process.exit(0);
  } catch (e) {
    logger.error({ err: e }, "[shutdown] failed");
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGUSR2", () => void gracefulShutdown("SIGUSR2"));
