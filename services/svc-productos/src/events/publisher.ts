import { randomUUID } from "node:crypto";
import { EVENTS, validateEventPayload } from "@erp/event-bus";
import type { EventName } from "@erp/shared-types";
import { pool } from "../db/pool.js";
import type { PoolClient } from "pg";
import { normalizeCorrelationId } from "@erp/logger";

export { EVENTS };

/**
 * Publicación transaccional vía outbox.
 * Si se pasa `client` (dentro de una transacción), el INSERT va en esa tx.
 * Si no, usa pool y la relay lo publicará en <500ms.
 */
export async function publishEvent<T>(
  name: EventName,
  payload: T,
  correlationId?: string,
  client?: PoolClient
): Promise<string> {
  validateEventPayload(name, payload);
  const eventId = randomUUID();
  const corr = normalizeCorrelationId(correlationId ?? randomUUID());
  const payloadJson = JSON.stringify(payload);

  const doInsert = async (c: PoolClient | typeof pool) => {
    // outbox es la fuente de verdad para el relay
    await c.query(
      `INSERT INTO outbox (id, nombre_evento, payload, correlation_id)
       VALUES ($1, $2, $3, $4)`,
      [eventId, name, payloadJson, corr]
    );
    // auditoría local (best-effort)
    await c.query(
      `INSERT INTO eventos_emitidos (id, nombre_evento, payload, correlation_id, estado)
       VALUES ($1, $2, $3, $4, 'emitido')`,
      [eventId, name, payloadJson, corr]
    );
  };

  if (client) {
    await doInsert(client);
  } else {
    const c = await pool.connect();
    try {
      await doInsert(c);
    } finally {
      c.release();
    }
  }

  return eventId;
}
