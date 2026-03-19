import Fastify from "fastify";
import pg from "pg";
import { pool, waitForDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { stockRoutes } from "./routes/stock.js";
import { healthRoutes } from "./routes/health.js";
import { registerSwagger } from "./routes/swagger.js";
import { startEventConsumer } from "./events/consumer.js";

const PORT = Number(process.env.PORT ?? 3003);
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
  await waitForDatabase();

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await runMigrations(client);
  } finally {
    await client.end();
  }

  await registerSwagger(app);
  await app.register(healthRoutes);
  await app.register(stockRoutes, { prefix: "/api/v1/stock" });

  await startEventConsumer();

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`svc-stock listening on http://${HOST}:${PORT}`);
  app.log.info(`Swagger UI: http://${HOST}:${PORT}/docs`);
}

bootstrap().catch((err) => {
  console.error("[fatal] Failed to start svc-stock:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
