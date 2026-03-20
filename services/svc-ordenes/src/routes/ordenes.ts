import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { publishEvent, EVENTS } from "../events/publisher.js";
import { CrearOrdenSchema } from "../domain/orden.schema.js";
import {
  type EstadoOrden,
  puedeTransicionar,
  describir,
} from "../domain/orden.statemachine.js";

export async function ordenesRoutes(app: FastifyInstance) {
  // GET /api/v1/ordenes
  app.get(
    "/",
    {
      schema: {
        tags: ["ordenes"],
        summary: "Listar órdenes",
        querystring: {
          type: "object",
          properties: {
            estado: { type: "string", enum: ["pendiente", "confirmada", "cancelada"] },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (req) => {
      const { estado, page = 1, pageSize = 20 } = req.query as {
        estado?: string;
        page?: number;
        pageSize?: number;
      };
      const offset = (page - 1) * pageSize;

      const whereClause = estado ? "WHERE o.estado = $3" : "";
      const params = estado
        ? [pageSize, offset, estado]
        : [pageSize, offset];

      const { rows: ordenes } = await pool.query(
        `SELECT o.id, o.estado, o.total, o.creada_en, o.actualizada_en,
                json_agg(json_build_object(
                  'productoId', l.producto_id,
                  'sku', l.sku,
                  'cantidad', l.cantidad,
                  'precioUnitario', l.precio_unitario,
                  'subtotal', l.subtotal
                )) FILTER (WHERE l.orden_id IS NOT NULL) AS lineas
         FROM ordenes o
         LEFT JOIN lineas_orden l ON l.orden_id = o.id
         ${whereClause}
         GROUP BY o.id
         ORDER BY o.creada_en DESC
         LIMIT $1 OFFSET $2`,
        params
      );

      const countParams = estado ? [estado] : [];
      const countWhere = estado ? "WHERE estado = $1" : "";
      const { rows: count } = await pool.query(
        `SELECT COUNT(*) AS total FROM ordenes ${countWhere}`,
        countParams
      );

      return {
        data: ordenes,
        meta: {
          total: Number(count[0].total),
          page,
          pageSize,
          totalPages: Math.ceil(Number(count[0].total) / pageSize),
        },
      };
    }
  );

  // GET /api/v1/ordenes/:id
  app.get(
    "/:id",
    {
      schema: {
        tags: ["ordenes"],
        summary: "Obtener una orden por ID",
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
        `SELECT o.id, o.estado, o.total, o.creada_en, o.actualizada_en,
                json_agg(json_build_object(
                  'productoId', l.producto_id,
                  'sku', l.sku,
                  'cantidad', l.cantidad,
                  'precioUnitario', l.precio_unitario,
                  'subtotal', l.subtotal
                )) FILTER (WHERE l.orden_id IS NOT NULL) AS lineas
         FROM ordenes o
         LEFT JOIN lineas_orden l ON l.orden_id = o.id
         WHERE o.id = $1
         GROUP BY o.id`,
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: `Orden ${id} no encontrada`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      return { data: rows[0] };
    }
  );

  // POST /api/v1/ordenes
  app.post(
    "/",
    {
      schema: {
        tags: ["ordenes"],
        summary: "Crear una nueva orden",
        body: {
          type: "object",
          required: ["lineas"],
          properties: {
            lineas: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["productoId", "sku", "cantidad", "precioUnitario"],
                properties: {
                  productoId: { type: "string", format: "uuid" },
                  sku: { type: "string" },
                  cantidad: { type: "integer", minimum: 1 },
                  precioUnitario: { type: "number", minimum: 0 },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = CrearOrdenSchema.safeParse(req.body);
      if (!parsed.success) {
        const message = parsed.error.issues
          .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
          .join("; ");
        return reply.status(400).send({
          error: "ValidationError",
          message,
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const { lineas } = parsed.data;
      const total = Math.round(
        lineas.reduce((sum, l) => sum + l.cantidad * l.precioUnitario, 0) * 100
      ) / 100;
      const ordenId = randomUUID();
      const correlationId = randomUUID();

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const { rows } = await client.query(
          `INSERT INTO ordenes (id, estado, total) VALUES ($1, 'pendiente', $2) RETURNING *`,
          [ordenId, total]
        );
        const orden = rows[0];

        for (const linea of lineas) {
          await client.query(
            `INSERT INTO lineas_orden (orden_id, producto_id, sku, cantidad, precio_unitario)
             VALUES ($1, $2, $3, $4, $5)`,
            [ordenId, linea.productoId, linea.sku, linea.cantidad, linea.precioUnitario]
          );
        }

        await client.query("COMMIT");

        await publishEvent(
          EVENTS.ORDEN_CREADA,
          {
            orden: {
              id: ordenId,
              estado: "pendiente",
              lineas,
              total,
              creadaEn: orden.creada_en,
              actualizadaEn: orden.actualizada_en,
            },
          },
          correlationId
        );

        return reply.status(201).send({ data: orden });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  );

  // POST /api/v1/ordenes/:id/cancelar
  app.post(
    "/:id/cancelar",
    {
      schema: {
        tags: ["ordenes"],
        summary: "Cancelar una orden pendiente",
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: { motivo: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { motivo } = (req.body as { motivo?: string }) ?? {};
      const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? randomUUID();

      // Fetch current state to validate transition explicitly
      const { rows: current } = await pool.query(
        "SELECT estado FROM ordenes WHERE id = $1",
        [id]
      );

      if (current.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: `Orden ${id} no encontrada`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      const estadoActual = current[0].estado as EstadoOrden;
      if (!puedeTransicionar(estadoActual, "cancelada")) {
        return reply.status(409).send({
          error: "Conflict",
          message: `No se puede cancelar la orden. ${describir(estadoActual)}`,
          statusCode: 409,
          timestamp: new Date().toISOString(),
        });
      }

      const { rows } = await pool.query(
        `UPDATE ordenes SET estado = 'cancelada', actualizada_en = NOW()
         WHERE id = $1 AND estado = $2
         RETURNING *`,
        [id, estadoActual]
      );

      if (rows.length === 0) {
        return reply.status(409).send({
          error: "Conflict",
          message: `Estado de la orden cambió durante el procesamiento. Intente de nuevo.`,
          statusCode: 409,
          timestamp: new Date().toISOString(),
        });
      }

      await publishEvent(EVENTS.ORDEN_CANCELADA, { ordenId: id, motivo }, correlationId);

      return { data: rows[0] };
    }
  );
}
