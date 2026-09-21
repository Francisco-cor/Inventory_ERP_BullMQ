import { EVENTS } from "@erp/event-bus";
import type {
  DomainEvent,
  OrdenCreadaPayload,
  OrdenConfirmadaPayload,
  OrdenCanceladaPayload,
} from "@erp/shared-types";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { eventBus } from "./bus.js";
import { broadcast } from "../sse/broker.js";

const OrdenCreadaSchema = z.object({
  orden: z.object({
    id: z.string().uuid(),
    estado: z.string(),
    lineas: z.array(
      z.object({
        productoId: z.string().uuid(),
        sku: z.string(),
        cantidad: z.number().int().min(1),
        precioUnitario: z.number().min(0),
      })
    ),
    total: z.number(),
    creadaEn: z.string(),
  }),
});

const OrdenConfirmadaSchema = z.object({ ordenId: z.string().uuid(), confirmadaEn: z.string() });
const OrdenCanceladaSchema = z.object({
  ordenId: z.string().uuid(),
  motivo: z.string().optional(),
});
const SlaWarningSchema = z.object({
  ordenId: z.string().uuid(),
  creadaEn: z.string(),
  segundosPendiente: z.number().int().min(0),
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

// Event receipt, event-log persistence, and any derived state change must share
// one transaction. Otherwise a failed derived write can leave the event marked
// as processed and make every retry silently skip it.
async function storeEvent(
  event: DomainEvent,
  applySideEffect?: (client: PoolClient) => Promise<void>
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      "INSERT INTO eventos_recibidos (event_id, nombre_evento) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING",
      [event.id, event.name]
    );
    if ((rowCount ?? 0) === 0) {
      await client.query("COMMIT");
      return false;
    }

    await client.query(
      `INSERT INTO event_log (event_id, event_name, source, correlation_id, payload, emitido_en)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.id,
        event.name,
        event.source,
        event.correlationId,
        JSON.stringify(event.payload),
        event.timestamp,
      ]
    );
    await applySideEffect?.(client);
    await client.query("COMMIT");
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

  // Broadcast to all connected SSE clients (via Redis adapter if enabled)
  try {
    await broadcast("event", {
      eventId: event.id,
      eventName: event.name,
      source: event.source,
      correlationId: event.correlationId,
      timestamp: event.timestamp,
      payload: event.payload,
    });
  } catch (err) {
    console.error("[consumer:obs] event broadcast failed", err);
  }

  return true;
}

async function onOrdenCreada(event: DomainEvent<OrdenCreadaPayload>): Promise<void> {
  validateOrThrow(OrdenCreadaSchema, event.payload, event.name);
  await storeEvent(event, async (client) => {
    await client.query(
      `INSERT INTO ordenes_sla (orden_id, creada_en)
       VALUES ($1, $2)
       ON CONFLICT (orden_id) DO NOTHING`,
      [event.payload.orden.id, event.payload.orden.creadaEn]
    );
  });
}

async function onOrdenConfirmada(event: DomainEvent<OrdenConfirmadaPayload>): Promise<void> {
  validateOrThrow(OrdenConfirmadaSchema, event.payload, event.name);
  await storeEvent(event, async (client) => {
    await client.query(
      `UPDATE ordenes_sla
       SET estado_sla = 'confirmada', resuelta_en = NOW()
       WHERE orden_id = $1 AND estado_sla IN ('pendiente', 'sla_warning')`,
      [event.payload.ordenId]
    );
  });
}

async function onOrdenCancelada(event: DomainEvent<OrdenCanceladaPayload>): Promise<void> {
  validateOrThrow(OrdenCanceladaSchema, event.payload, event.name);
  await storeEvent(event, async (client) => {
    await client.query(
      `UPDATE ordenes_sla
       SET estado_sla = 'cancelada', resuelta_en = NOW()
       WHERE orden_id = $1 AND estado_sla IN ('pendiente', 'sla_warning')`,
      [event.payload.ordenId]
    );
  });
}

async function onSlaWarning(event: DomainEvent): Promise<void> {
  const parsed = SlaWarningSchema.safeParse(event.payload);
  if (!parsed.success) {
    throw new Error(`ValidationError: payload inválido para ${event.name}`);
  }
  if (!(await storeEvent(event))) return;
  try {
    await broadcast("sla_warning", parsed.data);
  } catch (err) {
    console.error("[consumer:obs] SLA broadcast failed", err);
  }
}

// Generic handler for all other events (just store + broadcast)
async function onAnyEvent(event: DomainEvent): Promise<void> {
  if (!event.payload || typeof event.payload !== "object") {
    throw new Error(`ValidationError: payload inválido para ${event.name}: debe ser objeto`);
  }
  await storeEvent(event);
}

export function startEventConsumer(): void {
  eventBus.subscribe(EVENTS.ORDEN_CREADA, onOrdenCreada);
  eventBus.subscribe(EVENTS.ORDEN_CONFIRMADA, onOrdenConfirmada);
  eventBus.subscribe(EVENTS.ORDEN_CANCELADA, onOrdenCancelada);
  eventBus.subscribe(EVENTS.SLA_WARNING, onSlaWarning);

  // Track all other events for the event log
  eventBus.subscribe(EVENTS.PRODUCTO_CREADO, onAnyEvent);
  eventBus.subscribe(EVENTS.PRODUCTO_ACTUALIZADO, onAnyEvent);
  eventBus.subscribe(EVENTS.PRODUCTO_ELIMINADO, onAnyEvent);
  eventBus.subscribe(EVENTS.STOCK_RESERVADO, onAnyEvent);
  eventBus.subscribe(EVENTS.STOCK_INSUFICIENTE, onAnyEvent);
  eventBus.subscribe(EVENTS.STOCK_LIBERADO, onAnyEvent);
  eventBus.subscribe(EVENTS.STOCK_AJUSTADO, onAnyEvent);
  eventBus.subscribe(EVENTS.STOCK_ALERTA, onAnyEvent);

  eventBus.startWorker();
}
