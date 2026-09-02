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
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              db: { type: "string" },
              redis: { type: "string" },
              uptime: { type: "number" },
              pool: { type: "object" },
              outboxPending: { type: "number" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              db: { type: "string" },
              redis: { type: "string" },
              uptime: { type: "number" },
              pool: { type: "object" },
              outboxPending: { type: "number" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      let dbStatus = "ok";
      let redisStatus = "ok";
      let outboxPending = 0;

      try {
        await pool.query("SELECT 1");
      } catch (err) {
        dbStatus = "error";
      }

      try {
        await eventBus.ping();
      } catch (err) {
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
        service: "svc-productos",
        db: dbStatus,
        redis: redisStatus,
        uptime: process.uptime(),
        pool: getPoolMetrics(),
        outboxPending,
      };
    }
  );
}
