import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { publishEvent } from "../events/publisher.js";

const STOCK_UMBRAL = Number(process.env.STOCK_ALERTA_UMBRAL ?? 10);

async function registrarAlertaSiCorresponde(
  productoId: string,
  sku: string,
  disponible: number
): Promise<void> {
  if (disponible >= STOCK_UMBRAL) return;
  const tipo = disponible === 0 ? "stock_agotado" : "stock_bajo";
  await pool.query(
    `INSERT INTO alertas_stock (producto_id, sku, nivel_actual, umbral, tipo)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (producto_id) WHERE resuelta = false
     DO UPDATE SET nivel_actual = EXCLUDED.nivel_actual,
                   tipo         = EXCLUDED.tipo,
                   creada_en    = NOW()`,
    [productoId, sku, disponible, STOCK_UMBRAL, tipo]
  );
}

export async function stockRoutes(app: FastifyInstance) {
  // GET /api/v1/stock
  app.get(
    "/",
    {
      schema: {
        tags: ["stock"],
        summary: "Listar stock de todos los productos",
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (req) => {
      const { page = 1, pageSize = 20 } = req.query as {
        page?: number;
        pageSize?: number;
      };
      const offset = (page - 1) * pageSize;

      const { rows } = await pool.query(
        `SELECT producto_id, sku, disponible, reservado, total, actualizado_en
         FROM stock
         ORDER BY sku
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      );

      const { rows: count } = await pool.query("SELECT COUNT(*) AS total FROM stock");

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

  // GET /api/v1/stock/:productoId
  app.get(
    "/:productoId",
    {
      schema: {
        tags: ["stock"],
        summary: "Consultar stock de un producto",
        params: {
          type: "object",
          properties: { productoId: { type: "string", format: "uuid" } },
          required: ["productoId"],
        },
      },
    },
    async (req, reply) => {
      const { productoId } = req.params as { productoId: string };

      const { rows } = await pool.query(
        "SELECT * FROM stock WHERE producto_id = $1",
        [productoId]
      );

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: `Stock no encontrado para producto ${productoId}`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      return { data: rows[0] };
    }
  );

  // POST /api/v1/stock/:productoId/ajustar
  app.post(
    "/:productoId/ajustar",
    {
      schema: {
        tags: ["stock"],
        summary: "Ajustar manualmente el stock disponible de un producto",
        params: {
          type: "object",
          properties: { productoId: { type: "string", format: "uuid" } },
          required: ["productoId"],
        },
        body: {
          type: "object",
          required: ["delta", "motivo"],
          properties: {
            delta: { type: "integer", description: "Positivo para ingreso, negativo para egreso" },
            motivo: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const { productoId } = req.params as { productoId: string };
      const { delta, motivo } = req.body as { delta: number; motivo: string };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const { rows } = await client.query(
          "SELECT disponible FROM stock WHERE producto_id = $1 FOR UPDATE",
          [productoId]
        );

        if (rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({
            error: "NotFound",
            message: `Stock no encontrado para producto ${productoId}`,
            statusCode: 404,
            timestamp: new Date().toISOString(),
          });
        }

        const nuevoDisponible = rows[0].disponible + delta;
        if (nuevoDisponible < 0) {
          await client.query("ROLLBACK");
          return reply.status(409).send({
            error: "Conflict",
            message: `El ajuste resultaría en stock negativo (actual: ${rows[0].disponible}, delta: ${delta})`,
            statusCode: 409,
            timestamp: new Date().toISOString(),
          });
        }

        const { rows: updated } = await client.query(
          `UPDATE stock SET disponible = disponible + $1, actualizado_en = NOW()
           WHERE producto_id = $2
           RETURNING *`,
          [delta, productoId]
        );

        await client.query(
          `INSERT INTO movimientos_stock (producto_id, tipo, delta, motivo)
           VALUES ($1, 'ajuste', $2, $3)`,
          [productoId, delta, motivo]
        );

        await client.query("COMMIT");

        await publishEvent("stock.ajustado", { productoId, delta, motivo });

        // Registrar alerta si el stock disponible cae bajo el umbral
        await registrarAlertaSiCorresponde(
          productoId,
          updated[0].sku,
          updated[0].disponible
        );

        return { data: updated[0] };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  );

  // GET /api/v1/stock/:productoId/movimientos
  app.get(
    "/:productoId/movimientos",
    {
      schema: {
        tags: ["stock"],
        summary: "Historial de movimientos de stock de un producto",
        params: {
          type: "object",
          properties: { productoId: { type: "string", format: "uuid" } },
          required: ["productoId"],
        },
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (req) => {
      const { productoId } = req.params as { productoId: string };
      const { page = 1, pageSize = 20 } = req.query as {
        page?: number;
        pageSize?: number;
      };
      const offset = (page - 1) * pageSize;

      const { rows } = await pool.query(
        `SELECT id, tipo, delta, referencia_id, motivo, creado_en
         FROM movimientos_stock
         WHERE producto_id = $1
         ORDER BY creado_en DESC
         LIMIT $2 OFFSET $3`,
        [productoId, pageSize, offset]
      );

      const { rows: count } = await pool.query(
        "SELECT COUNT(*) AS total FROM movimientos_stock WHERE producto_id = $1",
        [productoId]
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
}
