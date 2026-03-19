import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", { schema: { tags: ["health"], summary: "Health check" } }, async (_req, reply) => {
    let dbStatus = "ok";
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
    } catch {
      dbStatus = "error";
      reply.status(503);
    }
    return {
      status: dbStatus === "ok" ? "ok" : "degraded",
      service: "svc-ordenes",
      db: dbStatus,
      uptime: process.uptime(),
    };
  });
}
