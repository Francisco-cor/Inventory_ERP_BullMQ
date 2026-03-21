import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import pg from "pg";
import { pool, waitForDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { healthRoutes } from "./routes/health.js";
import { obsRoutes } from "./routes/obs.js";
import { adminRoutes } from "./routes/admin.js";
import { startEventConsumer } from "./events/consumer.js";
import { eventBus } from "./events/bus.js";
import { startSlaChecker, stopSlaChecker } from "./jobs/sla-checker.js";

const PORT       = Number(process.env.PORT      ?? 3004);
const HOST       = process.env.HOST             ?? "0.0.0.0";
const REDIS_HOST = process.env.REDIS_HOST       ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } },
  },
});

async function bootstrap(): Promise<void> {
  await waitForDatabase();

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await runMigrations(client);
  } finally {
    await client.end();
  }

  await app.register(cors, { origin: true });

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
  await app.register(obsRoutes, { prefix: "/api/v1/obs" });
  await app.register(adminRoutes, { prefix: "/admin" });

  startEventConsumer();
  await startSlaChecker({ host: REDIS_HOST, port: REDIS_PORT });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`svc-obs listening on http://${HOST}:${PORT}`);
  app.log.info(`SSE stream: http://${HOST}:${PORT}/api/v1/obs/events/stream`);
}

bootstrap().catch((err) => {
  console.error("[fatal] Failed to start svc-obs:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await stopSlaChecker();
  await app.close();
  await eventBus.close();
  await pool.end();
  process.exit(0);
});
