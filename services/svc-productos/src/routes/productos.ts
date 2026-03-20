import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { publishEvent } from "../events/publisher.js";
import {
  CrearProductoSchema,
  ActualizarProductoSchema,
} from "../domain/producto.schema.js";

export async function productosRoutes(app: FastifyInstance) {
  // GET /api/v1/productos
  app.get(
    "/",
    {
      schema: {
        tags: ["productos"],
        summary: "Listar todos los productos activos",
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

      const { rows: data } = await pool.query(
        `SELECT id, sku, nombre, descripcion, precio, unidad, activo, creado_en, actualizado_en
         FROM productos
         WHERE activo = true
         ORDER BY creado_en DESC
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      );

      const { rows: count } = await pool.query(
        "SELECT COUNT(*) AS total FROM productos WHERE activo = true"
      );

      return {
        data,
        meta: {
          total: Number(count[0].total),
          page,
          pageSize,
          totalPages: Math.ceil(Number(count[0].total) / pageSize),
        },
      };
    }
  );

  // GET /api/v1/productos/:id
  app.get(
    "/:id",
    {
      schema: {
        tags: ["productos"],
        summary: "Obtener un producto por ID",
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
        "SELECT * FROM productos WHERE id = $1",
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: `Producto ${id} no encontrado`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      return { data: rows[0] };
    }
  );

  // POST /api/v1/productos
  app.post(
    "/",
    {
      schema: {
        tags: ["productos"],
        summary: "Crear un nuevo producto",
        body: {
          type: "object",
          required: ["sku", "nombre", "precio"],
          properties: {
            sku: { type: "string" },
            nombre: { type: "string" },
            descripcion: { type: "string" },
            precio: { type: "number", minimum: 0 },
            unidad: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = CrearProductoSchema.safeParse(req.body);
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

      const { sku, nombre, descripcion, precio, unidad } = parsed.data;
      const id = randomUUID();

      const { rows } = await pool.query(
        `INSERT INTO productos (id, sku, nombre, descripcion, precio, unidad)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [id, sku, nombre, descripcion ?? null, precio, unidad]
      );

      const producto = rows[0];

      await publishEvent("producto.creado", { producto });

      return reply.status(201).send({ data: producto });
    }
  );

  // PATCH /api/v1/productos/:id
  app.patch(
    "/:id",
    {
      schema: {
        tags: ["productos"],
        summary: "Actualizar un producto",
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = ActualizarProductoSchema.safeParse(req.body);

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

      const cambios = parsed.data;
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      for (const [key, value] of Object.entries(cambios)) {
        if (value !== undefined) {
          const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
          setClauses.push(`${col} = $${i++}`);
          values.push(value);
        }
      }

      if (setClauses.length === 0) {
        return reply.status(400).send({
          error: "ValidationError",
          message: "No hay campos para actualizar",
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      values.push(id);
      const { rows } = await pool.query(
        `UPDATE productos SET ${setClauses.join(", ")} WHERE id = $${i} RETURNING *`,
        values
      );

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: `Producto ${id} no encontrado`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      await publishEvent("producto.actualizado", {
        productoId: id,
        cambios,
      });

      return { data: rows[0] };
    }
  );

  // DELETE /api/v1/productos/:id
  app.delete(
    "/:id",
    {
      schema: {
        tags: ["productos"],
        summary: "Desactivar (soft delete) un producto",
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
        "UPDATE productos SET activo = false WHERE id = $1 AND activo = true RETURNING id",
        [id]
      );

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "NotFound",
          message: `Producto ${id} no encontrado o ya estaba inactivo`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      await publishEvent("producto.eliminado", { productoId: id });

      return reply.status(204).send();
    }
  );
}
