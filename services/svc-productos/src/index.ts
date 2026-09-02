import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import pg from "pg";
import { registerSecurity } from "@erp/auth";
import { pool, waitForDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { productosRoutes } from "./routes/productos.js";
import { healthRoutes } from "./routes/health.js";
import { adminRoutes } from "./routes/admin.js";
import { registerSwagger } from "./routes/swagger.js";
import { eventBus } from "./events/bus.js";
import { startOutboxRelay, stopOutboxRelay } from "./jobs/outbox-relay.js";
import { startRetentionJob, stopRetentionJob } from "./jobs/retention.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } },
  },
});

async function bootstrap() {
  // 1. Wait for DB and run migrations
  await waitForDatabase();

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await runMigrations(client);
  } finally {
    await client.end();
  }

  // 2. Security (helmet + cors) — must be first
  await registerSecurity(app);

  // 3. Rate limiting
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

  // 4. Centralized error handler
  app.setErrorHandler((err, _req, reply) => {
    const e = err as { validation?: unknown; message?: string };
    if (e.validation) {
      return reply.status(400).send({
        error: "ValidationError",
        message: e.message ?? "Validation error",
        statusCode: 400,
        timestamp: new Date().toISOString(),
      });
    }
    app.log.error(err);
    return reply.status(500).send({
      error: "InternalServerError",
      message: "Error interno del servidor",
      statusCode: 500,
      timestamp: new Date().toISOString(),
    });
  });

  // 5. Register OpenAPI / Swagger
  await registerSwagger(app);

  // 6. Register routes
  await app.register(healthRoutes);
  await app.register(productosRoutes, { prefix: "/api/v1/productos" });
  // Alias en inglés para compatibilidad README/docs — mismo handler, distinto prefix
  await app.register(productosRoutes, { prefix: "/api/v1/products" });
  await app.register(adminRoutes, { prefix: "/admin" });

  // 6b. Bull Board (admin queues) — /admin/queues
  try {
    const { createBullBoard } = await import("@bull-board/api");
    const { BullMQAdapter } = await import("@bull-board/api/bullMQAdapter");
    const { FastifyAdapter } = await import("@bull-board/fastify");
    const { Queue } = await import("bullmq");
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath("/admin/queues");
    const q = new Queue("events-svc-productos", {
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

  // 6c. Outbox relay + retention
  startOutboxRelay();
  startRetentionJob();

  // 7. Start server
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`svc-productos listening on http://${HOST}:${PORT}`);
  app.log.info(`Swagger UI: http://${HOST}:${PORT}/docs`);
}

bootstrap().catch((err) => {
  console.error("[fatal] Failed to start svc-productos:", err);
  process.exit(1);
});

export let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] ${signal} received — draining (10s timeout)`);
  const timeout = setTimeout(() => {
    console.error("[shutdown] forced exit after 10s");
    process.exit(1);
  }, 10_000);
  timeout.unref?.();

  try {
    await stopOutboxRelay().catch((e) => console.error("[shutdown] stopOutboxRelay", e));
    await stopRetentionJob().catch((e) => console.error("[shutdown] stopRetentionJob", e));
    try {
      await app.close();
    } catch (e) {
      console.error("[shutdown] app.close", e);
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
    await eventBus.close().catch((e) => console.error("[shutdown] eventBus.close", e));
    await pool.end().catch((e) => console.error("[shutdown] pool.end", e));
    console.log("[shutdown] graceful exit");
    clearTimeout(timeout);
    process.exit(0);
  } catch (e) {
    console.error("[shutdown] failed", e);
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGUSR2", () => void gracefulShutdown("SIGUSR2"));
