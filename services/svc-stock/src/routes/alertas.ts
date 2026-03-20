import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";

export async function alertasRoutes(app: FastifyInstance) {
  // GET /api/v1/stock/alertas
  app.get(
    "/",
    {
      schema: {
        tags: ["alertas"],
        summary: "Listar alertas de stock bajo",
        querystring: {
          type: "object",
          properties: {
            resuelta: { type: "boolean", default: false },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (req) => {
      const { resuelta = false, page = 1, pageSize = 20 } = req.query as {
        resuelta?: boolean;
        page?: number;
        pageSize?: number;
      };
      const offset = (page - 1) * pageSize;

      const { rows } = await pool.query(
        `SELECT id, producto_id, sku, nivel_actual, umbral, tipo, resuelta, creada_en, resuelta_en
         FROM alertas_stock
         WHERE resuelta = $1
         ORDER BY creada_en DESC
         LIMIT $2 OFFSET $3`,
        [resuelta, pageSize, offset]
      );

      const { rows: count } = await pool.query(
        "SELECT COUNT(*) AS total FROM alertas_stock WHERE resuelta = $1",
        [resuelta]
      );

      return {
        data: rows,
        meta: {
          total: Number(count[0].total),
          page,
          pageSize,
          totalPages: Math.ceil(Number(count[0].total) / pageSize),
        },
      };
    }
  );

  // PATCH /api/v1/stock/alertas/:id/resolver
  app.patch(
    "/:id/resolver",
    {
      schema: {
        tags: ["alertas"],
        summary: "Marcar una alerta de stock como resuelta",
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const { rows } = await pool.query(
        `UPDATE alertas_stock
         SET resuelta = true, resuelta_en = NOW()
         WHERE id = $1 AND resuelta = false
         RETURNING *`,
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: `Alerta ${id} no encontrada o ya estaba resuelta`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      return { data: rows[0] };
    }
  );
}
