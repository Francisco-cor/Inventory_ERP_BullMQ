import type { FastifyInstance } from "fastify";
import { eventBus } from "../events/bus.js";

export async function adminRoutes(app: FastifyInstance) {
  app.get(
    "/dlq",
    {
      schema: {
        tags: ["admin"],
        summary: "Listar eventos en la Dead Letter Queue",
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
          },
        },
      },
    },
    async (req) => {
      const { limit = 50 } = req.query as { limit?: number };
      const jobs = await eventBus.getFailedJobs(0, limit - 1);
      return { data: jobs, meta: { count: jobs.length } };
    }
  );
}
