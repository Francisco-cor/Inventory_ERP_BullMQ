import { EVENTS } from "@erp/event-bus";
import type {
  DomainEvent,
  OrdenCreadaPayload,
  OrdenConfirmadaPayload,
  OrdenCanceladaPayload,
} from "@erp/shared-types";
import { pool } from "../db/pool.js";
import { eventBus } from "./bus.js";
import { broadcast } from "../sse/broker.js";

async function isAlreadyProcessed(eventId: string, eventName: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "INSERT INTO eventos_recibidos (event_id, nombre_evento) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING",
    [eventId, eventName]
  );
  return (rowCount ?? 0) === 0;
}

async function storeAndBroadcast(event: DomainEvent): Promise<void> {
  if (await isAlreadyProcessed(event.id, event.name)) return;

  const client = await pool.connect();
  try {
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
  } finally {
    client.release();
  }

  // Broadcast to all connected SSE clients
  broadcast("event", {
    eventId: event.id,
    eventName: event.name,
    source: event.source,
    correlationId: event.correlationId,
    timestamp: event.timestamp,
    payload: event.payload,
  });
}

async function onOrdenCreada(event: DomainEvent<OrdenCreadaPayload>): Promise<void> {
  await storeAndBroadcast(event);

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ordenes_sla (orden_id, creada_en)
       VALUES ($1, $2)
       ON CONFLICT (orden_id) DO NOTHING`,
      [event.payload.orden.id, event.payload.orden.creadaEn]
    );
  } finally {
    client.release();
  }
}

async function onOrdenConfirmada(event: DomainEvent<OrdenConfirmadaPayload>): Promise<void> {
  await storeAndBroadcast(event);

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE ordenes_sla
       SET estado_sla = 'confirmada', resuelta_en = NOW()
       WHERE orden_id = $1 AND estado_sla IN ('pendiente', 'sla_warning')`,
      [event.payload.ordenId]
    );
  } finally {
    client.release();
  }
}

async function onOrdenCancelada(event: DomainEvent<OrdenCanceladaPayload>): Promise<void> {
  await storeAndBroadcast(event);

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE ordenes_sla
       SET estado_sla = 'cancelada', resuelta_en = NOW()
       WHERE orden_id = $1 AND estado_sla IN ('pendiente', 'sla_warning')`,
      [event.payload.ordenId]
    );
  } finally {
    client.release();
  }
}

// Generic handler for all other events (just store + broadcast)
async function onAnyEvent(event: DomainEvent): Promise<void> {
  await storeAndBroadcast(event);
}

export function startEventConsumer(): void {
  eventBus.subscribe(EVENTS.ORDEN_CREADA, onOrdenCreada);
  eventBus.subscribe(EVENTS.ORDEN_CONFIRMADA, onOrdenConfirmada);
  eventBus.subscribe(EVENTS.ORDEN_CANCELADA, onOrdenCancelada);

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
