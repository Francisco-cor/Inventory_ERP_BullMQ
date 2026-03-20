import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { clientCount } from "../sse/broker.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            service: { type: "string" },
            sseClients: { type: "number" },
            timestamp: { type: "string" },
          },
        },
        503: {
          type: "object",
          properties: {
            status: { type: "string" },
            error: { type: "string" },
            timestamp: { type: "string" },
          },
        },
      },
    },
  }, async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return reply.send({
        status: "ok",
        service: "svc-obs",
        sseClients: clientCount(),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return reply.status(503).send({
        status: "error",
        error: "Database unavailable",
        timestamp: new Date().toISOString(),
      });
    }
  });
}
