import type { FastifyInstance } from "fastify";
import { pool, getPoolMetrics } from "../db/pool.js";
import { clientCount } from "../sse/broker.js";
import { eventBus } from "../events/bus.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              db: { type: "string" },
              redis: { type: "string" },
              sseClients: { type: "number" },
              pool: { type: "object" },
              outboxPending: { type: "number" },
              timestamp: { type: "string" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              db: { type: "string" },
              redis: { type: "string" },
              sseClients: { type: "number" },
              pool: { type: "object" },
              outboxPending: { type: "number" },
              timestamp: { type: "string" },
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
      return reply.status(healthy ? 200 : 503).send({
        status: healthy ? "ok" : "degraded",
        service: "svc-obs",
        db: dbStatus,
        redis: redisStatus,
        sseClients: clientCount(),
        pool: getPoolMetrics(),
        outboxPending,
        timestamp: new Date().toISOString(),
      });
    }
  );
}
