import { EVENTS } from "@erp/event-bus";
import type { EventName } from "@erp/shared-types";
import { pool } from "../db/pool.js";
import { eventBus } from "./bus.js";

// Re-export EVENTS so routes can import from one place
export { EVENTS };

export async function publishEvent<T>(
  name: EventName,
  payload: T,
  correlationId?: string
): Promise<void> {
  const eventId = await eventBus.publish(name, payload, correlationId);

  // Persist to local event store for observability
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO eventos_emitidos (id, nombre_evento, payload, correlation_id, estado)
       VALUES ($1, $2, $3, $4, 'emitido')`,
      [eventId, name, JSON.stringify(payload), correlationId ?? eventId]
    );
  } finally {
    client.release();
  }
}
