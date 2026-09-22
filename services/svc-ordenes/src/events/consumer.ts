import { EVENTS } from "@erp/event-bus";
import type {
  DomainEvent,
  StockReservadoPayload,
  StockInsuficientePayload,
} from "@erp/shared-types";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { publishEvent } from "./publisher.js";
import { eventBus } from "./bus.js";

const StockReservadoSchema = z.object({
  ordenId: z.string().uuid(),
  items: z.array(z.object({ productoId: z.string().uuid(), cantidad: z.number().int().min(1) })),
});

const StockInsuficienteSchema = z.object({
  ordenId: z.string().uuid(),
  sku: z.string().min(1),
  disponible: z.number().int().min(0),
  requerido: z.number().int().min(1),
});

const ProductoCreadoSchema = z.object({
  producto: z
    .object({
      id: z.string().uuid(),
      sku: z.string().min(1),
      precio: z.coerce.number().nonnegative(),
      activo: z.boolean().default(true),
      actualizado_en: z.string().optional(),
      actualizadoEn: z.string().optional(),
    })
    .passthrough(),
});

const ProductoActualizadoSchema = z.object({
  productoId: z.string().uuid(),
  cambios: z.record(z.unknown()),
});

const ProductoEliminadoSchema = z.object({ productoId: z.string().uuid() });

function validateOrThrow<T>(schema: z.ZodSchema<T>, payload: unknown, eventName: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `ValidationError: payload inválido para ${eventName}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
  return parsed.data;
}

async function isAlreadyProcessed(
  client: PoolClient,
  eventId: string,
  eventName: string
): Promise<boolean> {
  const { rowCount } = await client.query(
    "INSERT INTO eventos_recibidos (event_id, nombre_evento) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING",
    [eventId, eventName]
  );
  return (rowCount ?? 0) === 0;
}

async function storeCatalogEvent(
  event: DomainEvent,
  apply: (client: PoolClient) => Promise<void>
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (await isAlreadyProcessed(client, event.id, event.name)) {
      await client.query("COMMIT");
      return;
    }
    await apply(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function productSourceTimestamp(
  product: { actualizado_en?: string; actualizadoEn?: string },
  event: DomainEvent
): string {
  return product.actualizado_en ?? product.actualizadoEn ?? event.timestamp;
}

async function onProductoCreado(event: DomainEvent): Promise<void> {
  const { producto } = validateOrThrow(ProductoCreadoSchema, event.payload, event.name);
  await storeCatalogEvent(event, async (client) => {
    await client.query(
      `INSERT INTO catalogo_productos
         (producto_id, sku, precio, activo, version_precio, source_event_id, source_updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6)
       ON CONFLICT (producto_id) DO UPDATE SET
         sku = EXCLUDED.sku,
         precio = EXCLUDED.precio,
         activo = EXCLUDED.activo,
         version_precio = catalogo_productos.version_precio
           + CASE WHEN catalogo_productos.precio IS DISTINCT FROM EXCLUDED.precio THEN 1 ELSE 0 END,
         source_event_id = EXCLUDED.source_event_id,
         source_updated_at = EXCLUDED.source_updated_at,
         synced_at = NOW()
       WHERE catalogo_productos.source_updated_at <= EXCLUDED.source_updated_at`,
      [
        producto.id,
        producto.sku,
        producto.precio,
        producto.activo,
        event.id,
        productSourceTimestamp(producto, event),
      ]
    );
  });
}

async function onProductoActualizado(event: DomainEvent): Promise<void> {
  const { productoId, cambios } = validateOrThrow(
    ProductoActualizadoSchema,
    event.payload,
    event.name
  );
  const sku = typeof cambios.sku === "string" ? cambios.sku : null;
  const precio =
    cambios.precio === undefined || cambios.precio === null ? null : Number(cambios.precio);
  const activo = typeof cambios.activo === "boolean" ? cambios.activo : null;
  if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
    throw new Error(`Precio inválido en ${event.name}`);
  }

  await storeCatalogEvent(event, async (client) => {
    const { rows } = await client.query<{ source_updated_at: Date }>(
      "SELECT source_updated_at FROM catalogo_productos WHERE producto_id = $1 FOR UPDATE",
      [productoId]
    );
    if (rows.length === 0) throw new Error(`Proyección de catálogo ausente para ${productoId}`);
    if (new Date(rows[0].source_updated_at) >= new Date(event.timestamp)) return;

    await client.query(
      `UPDATE catalogo_productos
       SET sku = COALESCE($2, sku),
           precio = COALESCE($3, precio),
           activo = COALESCE($4, activo),
           version_precio = version_precio +
             CASE WHEN $3 IS NOT NULL AND precio IS DISTINCT FROM $3 THEN 1 ELSE 0 END,
           source_event_id = $5, source_updated_at = $6, synced_at = NOW()
       WHERE producto_id = $1`,
      [productoId, sku, precio, activo, event.id, event.timestamp]
    );
  });
}

async function onProductoEliminado(event: DomainEvent): Promise<void> {
  const { productoId } = validateOrThrow(ProductoEliminadoSchema, event.payload, event.name);
  await storeCatalogEvent(event, async (client) => {
    const { rows } = await client.query<{ source_updated_at: Date }>(
      "SELECT source_updated_at FROM catalogo_productos WHERE producto_id = $1 FOR UPDATE",
      [productoId]
    );
    if (rows.length === 0) throw new Error(`Proyección de catálogo ausente para ${productoId}`);
    if (new Date(rows[0].source_updated_at) >= new Date(event.timestamp)) return;
    await client.query(
      `UPDATE catalogo_productos
       SET activo = false, source_event_id = $2, source_updated_at = $3, synced_at = NOW()
       WHERE producto_id = $1`,
      [productoId, event.id, event.timestamp]
    );
  });
}

// stock.reservado → confirmar orden + emitir orden.confirmada
async function onStockReservado(event: DomainEvent<StockReservadoPayload>): Promise<void> {
  validateOrThrow(StockReservadoSchema, event.payload, event.name);

  const { ordenId } = event.payload;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (await isAlreadyProcessed(client, event.id, event.name)) {
      await client.query("COMMIT");
      console.log(`[consumer:ordenes] Skipping duplicate ${event.id}`);
      return;
    }

    const { rowCount } = await client.query(
      `UPDATE ordenes SET estado = 'confirmada', actualizada_en = NOW()
       WHERE id = $1 AND estado = 'pendiente'`,
      [ordenId]
    );

    if ((rowCount ?? 0) > 0) {
      await publishEvent(
        EVENTS.ORDEN_CONFIRMADA,
        { ordenId, confirmadaEn: new Date().toISOString() },
        event.correlationId,
        client
      );
      console.log(`[consumer:ordenes] Orden ${ordenId} confirmada`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// stock.insuficiente → cancelar orden
async function onStockInsuficiente(event: DomainEvent<StockInsuficientePayload>): Promise<void> {
  validateOrThrow(StockInsuficienteSchema, event.payload, event.name);

  const { ordenId, sku } = event.payload;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (await isAlreadyProcessed(client, event.id, event.name)) {
      await client.query("COMMIT");
      console.log(`[consumer:ordenes] Skipping duplicate ${event.id}`);
      return;
    }

    const { rowCount } = await client.query(
      `UPDATE ordenes SET estado = 'cancelada', actualizada_en = NOW()
       WHERE id = $1 AND estado = 'pendiente'`,
      [ordenId]
    );

    if ((rowCount ?? 0) > 0) {
      await publishEvent(
        EVENTS.ORDEN_CANCELADA,
        { ordenId, motivo: `Stock insuficiente para SKU ${sku}` },
        event.correlationId,
        client
      );
      console.log(`[consumer:ordenes] Orden ${ordenId} cancelada — stock insuficiente (${sku})`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function startEventConsumer(): void {
  eventBus.subscribe(EVENTS.PRODUCTO_CREADO, onProductoCreado);
  eventBus.subscribe(EVENTS.PRODUCTO_ACTUALIZADO, onProductoActualizado);
  eventBus.subscribe(EVENTS.PRODUCTO_ELIMINADO, onProductoEliminado);
  eventBus.subscribe(EVENTS.STOCK_RESERVADO, onStockReservado);
  eventBus.subscribe(EVENTS.STOCK_INSUFICIENTE, onStockInsuficiente);
  eventBus.startWorker();
}
