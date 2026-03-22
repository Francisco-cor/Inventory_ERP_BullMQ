import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { eventBus } from "../events/bus.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", { schema: { tags: ["health"], summary: "Health check" } }, async (_req, reply) => {
    console.log(`[health] Check requested for svc-ordenes`);
    let dbStatus = "ok";
    let redisStatus = "ok";

    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
    } catch (err) {
      console.error(`[health] DB Error in svc-ordenes:`, err);
      dbStatus = "error";
    }

    try {
      await eventBus.ping();
    } catch (err) {
      console.error(`[health] Redis Error in svc-ordenes:`, err);
      redisStatus = "error";
    }

    const healthy = dbStatus === "ok" && redisStatus === "ok";
    console.log(`[health] svc-ordenes status: ${healthy ? "ok" : "degraded"} (db:${dbStatus}, redis:${redisStatus})`);
    if (!healthy) reply.status(503);

    return {
      status: healthy ? "ok" : "degraded",
      service: "svc-ordenes",
      db: dbStatus,
      redis: redisStatus,
      uptime: process.uptime(),
    };
  });
}
