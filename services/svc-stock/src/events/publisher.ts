import { randomUUID } from "node:crypto";
import { EVENTS, validateEventPayload } from "@erp/event-bus";
import type { EventName } from "@erp/shared-types";
import { pool } from "../db/pool.js";
import type { PoolClient } from "pg";

export { EVENTS };

export async function publishEvent<T>(
  name: EventName,
  payload: T,
  correlationId?: string,
  client?: PoolClient
): Promise<string> {
  validateEventPayload(name, payload);
  const eventId = randomUUID();
  const corr = correlationId ?? randomUUID();
  const payloadJson = JSON.stringify(payload);

  const doInsert = async (c: PoolClient | typeof pool) => {
    await c.query(
      `INSERT INTO outbox (id, nombre_evento, payload, correlation_id)
       VALUES ($1, $2, $3, $4)`,
      [eventId, name, payloadJson, corr]
    );
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
