import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { eventBus } from "../events/bus.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", { schema: { tags: ["health"], summary: "Health check" } }, async (_req, reply) => {
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
      service: "svc-stock",
      db: dbStatus,
      redis: redisStatus,
      uptime: process.uptime(),
    };
  });
}
