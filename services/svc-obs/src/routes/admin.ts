import type { FastifyInstance } from "fastify";
import { eventBus } from "../events/bus.js";
import { requireApiKey } from "../plugins/auth.js";

export async function adminRoutes(app: FastifyInstance) {
  app.get(
    "/dlq",
    {
      preHandler: [requireApiKey],
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

  app.post(
    "/dlq/:jobId/retry",
    {
      preHandler: [requireApiKey],
      schema: {
        tags: ["admin"],
        summary: "Reintentar un job fallido de la Dead Letter Queue",
        params: {
          type: "object",
          properties: { jobId: { type: "string" } },
          required: ["jobId"],
        },
      },
    },
    async (req, reply) => {
      const { jobId } = req.params as { jobId: string };
      try {
        await eventBus.retryJob(jobId);
        return reply.status(200).send({ data: { jobId, status: "retried" } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply.status(404).send({
          error: "NotFound",
          message,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
}
