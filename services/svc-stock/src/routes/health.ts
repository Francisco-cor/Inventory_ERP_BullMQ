import type { FastifyInstance } from "fastify";
import { pool, getPoolMetrics } from "../db/pool.js";
import { eventBus } from "../events/bus.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Health check",
      },
    },
    async (_req, reply) => {
      let dbStatus = "ok";
      let redisStatus = "ok";
      let outboxPending = 0;
      try {
        await pool.query("SELECT 1");
      } catch {
        dbStatus = "error";
      }
      try {
        await eventBus.ping();
      } catch {
        redisStatus = "error";
      }
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS pending FROM outbox WHERE published_at IS NULL`
        );
        outboxPending = rows[0].pending;
      } catch {
        void 0;
      }
      const healthy = dbStatus === "ok" && redisStatus === "ok";
      if (!healthy) reply.status(503);
      return {
        status: healthy ? "ok" : "degraded",
        service: "svc-stock",
        db: dbStatus,
        redis: redisStatus,
        uptime: process.uptime(),
        pool: getPoolMetrics(),
        outboxPending,
      };
    }
  );

  app.get("/health/ready", async (_req, reply) => {
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
    return reply.send({ status: "ok", service: "svc-stock" });
  });

  app.get("/health/live", async (_req, reply) => {
    return reply.send({ status: "ok", service: "svc-stock", uptime: process.uptime() });
  });
}
