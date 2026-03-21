import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
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
            },
          },
        },
      },
    },
    async (_req, reply) => {
      let dbStatus = "ok";
      let redisStatus = "ok";

      try {
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
      } catch {
        dbStatus = "error";
      }

      try {
        await eventBus.ping();
      } catch {
        redisStatus = "error";
      }

      const healthy = dbStatus === "ok" && redisStatus === "ok";
      if (!healthy) reply.status(503);

      return {
        status: healthy ? "ok" : "degraded",
        service: "svc-productos",
        db: dbStatus,
        redis: redisStatus,
        uptime: process.uptime(),
      };
    }
  );
}
