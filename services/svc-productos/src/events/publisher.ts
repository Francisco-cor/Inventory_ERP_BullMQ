import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import type { DomainEvent, EventName } from "@erp/shared-types";
import { pool } from "../db/pool.js";

const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const eventQueue = new Queue("domain-events", { connection });

export async function publishEvent<T>(
  name: EventName,
  payload: T,
  correlationId?: string
): Promise<void> {
  const event: DomainEvent<T> = {
    id: randomUUID(),
    name,
    payload,
    timestamp: new Date().toISOString(),
    source: "svc-productos",
    correlationId: correlationId ?? randomUUID(),
  };

  // Outbox pattern: persist before enqueue
  const client = await pool.connect();
  try {
    const job = await eventQueue.add(name, event, {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
    });

    await client.query(
      `INSERT INTO eventos_emitidos (id, nombre_evento, payload, correlation_id, job_id, estado)
       VALUES ($1, $2, $3, $4, $5, 'emitido')`,
      [event.id, event.name, JSON.stringify(event.payload), event.correlationId, job.id]
    );
  } finally {
    client.release();
  }
}
