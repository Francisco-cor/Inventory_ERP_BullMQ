import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import pg from "pg";
import { pool, waitForDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { productosRoutes } from "./routes/productos.js";
import { healthRoutes } from "./routes/health.js";
import { adminRoutes } from "./routes/admin.js";
import { registerSwagger } from "./routes/swagger.js";
import { eventBus } from "./events/bus.js";

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

  // 2. Rate limiting
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

  // 3. Centralized error handler
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

  // 4. Register OpenAPI / Swagger
  await registerSwagger(app);

  // 5. Register routes
  await app.register(healthRoutes);
  await app.register(productosRoutes, { prefix: "/api/v1/productos" });
  await app.register(adminRoutes, { prefix: "/admin" });

  // 6. Start server
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`svc-productos listening on http://${HOST}:${PORT}`);
  app.log.info(`Swagger UI: http://${HOST}:${PORT}/docs`);
}

bootstrap().catch((err) => {
  console.error("[fatal] Failed to start svc-productos:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await app.close();
  await eventBus.close();
  await pool.end();
  process.exit(0);
});
