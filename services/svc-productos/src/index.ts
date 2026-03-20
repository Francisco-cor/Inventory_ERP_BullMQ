import Fastify from "fastify";
import pg from "pg";
import { pool, waitForDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { productosRoutes } from "./routes/productos.js";
import { healthRoutes } from "./routes/health.js";
import { registerSwagger } from "./routes/swagger.js";

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

  // 2. Centralized error handler
  app.setErrorHandler((error, _req, reply) => {
    if (error.validation) {
      return reply.status(400).send({
        error: "ValidationError",
        message: error.message,
        statusCode: 400,
        timestamp: new Date().toISOString(),
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: "InternalServerError",
      message: "Error interno del servidor",
      statusCode: 500,
      timestamp: new Date().toISOString(),
    });
  });

  // 3. Register OpenAPI / Swagger
  await registerSwagger(app);

  // 4. Register routes
  await app.register(healthRoutes);
  await app.register(productosRoutes, { prefix: "/api/v1/productos" });

  // 4. Start server
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`svc-productos listening on http://${HOST}:${PORT}`);
  app.log.info(`Swagger UI: http://${HOST}:${PORT}/docs`);
}

bootstrap().catch((err) => {
  console.error("[fatal] Failed to start svc-productos:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
