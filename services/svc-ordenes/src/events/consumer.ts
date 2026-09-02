import { EVENTS } from "@erp/event-bus";
import type { DomainEvent, StockReservadoPayload, StockInsuficientePayload } from "@erp/shared-types";
import { z } from "zod";
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
  client: import("pg").PoolClient,
  eventId: string,
  eventName: string
): Promise<boolean> {
  const { rowCount } = await client.query(
    "INSERT INTO eventos_recibidos (event_id, nombre_evento) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING",
    [eventId, eventName]
  );
  return (rowCount ?? 0) === 0;
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
  eventBus.subscribe(EVENTS.STOCK_RESERVADO, onStockReservado);
  eventBus.subscribe(EVENTS.STOCK_INSUFICIENTE, onStockInsuficiente);
  eventBus.startWorker();
}
