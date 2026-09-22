import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { eventBus } from "../events/bus.js";
import { requireAuth, requireRole } from "../plugins/auth.js";

export async function adminRoutes(app: FastifyInstance) {
  app.get(
    "/outbox-dlq",
    {
      preHandler: [requireAuth, requireRole("admin")],
      schema: {
        tags: ["admin"],
        summary: "Listar entregas del outbox en DLQ",
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
            destination: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (req) => {
      const { limit = 50, destination } = req.query as {
        limit?: number;
        destination?: string;
      };
      const { rows } = await pool.query(
        `SELECT id::text AS id, outbox_id, destination, nombre_evento, payload,
                correlation_id, attempts, last_error, failed_at
         FROM outbox_delivery_dlq
         WHERE ($1::text IS NULL OR destination = $1)
         ORDER BY failed_at DESC
         LIMIT $2`,
        [destination ?? null, limit]
      );
      return { data: rows, meta: { count: rows.length } };
    }
  );

  app.get(
    "/outbox-dlq/stats",
    {
      preHandler: [requireAuth, requireRole("admin")],
      schema: {
        tags: ["admin"],
        summary: "Estadísticas del DLQ durable del outbox",
      },
    },
    async () => {
      const { rows } = await pool.query(
        `SELECT destination, COUNT(*)::int AS count,
                MAX(failed_at) AS last_failed_at
         FROM outbox_delivery_dlq
         GROUP BY destination
         ORDER BY destination`
      );
      return { data: rows, meta: { count: rows.length } };
    }
  );

  app.post(
    "/outbox-dlq/:id/retry",
    {
      preHandler: [requireAuth, requireRole("admin")],
      schema: {
        tags: ["admin"],
        summary: "Reintentar una entrega durable del outbox",
        params: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^[1-9][0-9]*$" },
          },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT outbox_id, destination
           FROM outbox_delivery_dlq
           WHERE id = $1::bigint
           FOR UPDATE`,
          [id]
        );
        const entry = rows[0] as { outbox_id: string; destination: string } | undefined;
        if (!entry) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "NotFound",
            message: "Entrega de outbox no encontrada en DLQ",
            statusCode: 404,
            timestamp: new Date().toISOString(),
          });
        }

        await client.query(
          `UPDATE outbox_deliveries
           SET estado = 'pending',
               published_at = NULL,
               attempts = 0,
               last_error = NULL,
               lease_token = NULL,
               lease_until = NULL,
               dead_lettered_at = NULL
           WHERE outbox_id = $1 AND destination = $2`,
          [entry.outbox_id, entry.destination]
        );
        await client.query("DELETE FROM outbox_delivery_dlq WHERE id = $1::bigint", [id]);
        await client.query(
          "UPDATE outbox SET estado = 'pending', published_at = NULL WHERE id = $1",
          [entry.outbox_id]
        );
        await client.query("COMMIT");

        return reply.status(200).send({
          data: {
            id,
            outboxId: entry.outbox_id,
            destination: entry.destination,
            status: "pending",
          },
        });
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          void 0;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  );

  app.get(
    "/dlq",
    {
      preHandler: [requireAuth, requireRole("admin")],
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

  app.get(
    "/dlq/stats",
    {
      preHandler: [requireAuth, requireRole("admin")],
      schema: {
        tags: ["admin"],
        summary: "Estadísticas de la Dead Letter Queue agrupadas por tipo de error",
      },
    },
    async () => {
      const stats = await eventBus.getFailedJobStats();
      return { data: stats };
    }
  );

  app.post(
    "/dlq/:jobId/retry",
    {
      preHandler: [requireAuth, requireRole("admin")],
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
