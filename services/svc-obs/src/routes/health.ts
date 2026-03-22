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
    console.log(`[health] Check requested for svc-obs`);
    let dbStatus = "ok";
    let redisStatus = "ok";

    try {
      await pool.query("SELECT 1");
    } catch (err) {
      console.error(`[health] DB Error in svc-obs:`, err);
      dbStatus = "error";
    }

    try {
      await eventBus.ping();
    } catch (err) {
      console.error(`[health] Redis Error in svc-obs:`, err);
      redisStatus = "error";
    }

    const healthy = dbStatus === "ok" && redisStatus === "ok";
    console.log(`[health] svc-obs status: ${healthy ? "ok" : "degraded"} (db:${dbStatus}, redis:${redisStatus})`);
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
