import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { clientCount } from "../sse/broker.js";
import { eventBus } from "../events/bus.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", {
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
            timestamp: { type: "string" },
          },
        },
      },
    },
  }, async (_req, reply) => {
    let dbStatus = "ok";
    let redisStatus = "ok";

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

    const healthy = dbStatus === "ok" && redisStatus === "ok";
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      service: "svc-obs",
      db: dbStatus,
      redis: redisStatus,
      sseClients: clientCount(),
      timestamp: new Date().toISOString(),
    });
  });
}
