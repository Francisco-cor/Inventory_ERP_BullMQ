import { Worker } from "bullmq";
import type { DomainEvent } from "@erp/shared-types";
import { pool } from "../db/pool.js";

const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

// svc-ordenes reacts to stock events (e.g. stock.reservado → confirmar orden)
export function startEventConsumer(): void {
  const worker = new Worker<DomainEvent>(
    "domain-events",
    async (job) => {
      const event = job.data;

      // Idempotency check
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          "SELECT event_id FROM eventos_recibidos WHERE event_id = $1",
          [event.id]
        );
        if (rows.length > 0) {
          console.log(`[consumer] Skipping duplicate event ${event.id}`);
          return;
        }

        await client.query(
          "INSERT INTO eventos_recibidos (event_id, nombre_evento) VALUES ($1, $2)",
          [event.id, event.name]
        );

        switch (event.name) {
          case "stock.reservado": {
            const payload = event.payload as { ordenId: string };
            await client.query(
              `UPDATE ordenes SET estado = 'confirmada', actualizada_en = NOW()
               WHERE id = $1 AND estado = 'pendiente'`,
              [payload.ordenId]
            );
            console.log(`[consumer] Orden ${payload.ordenId} confirmada tras reserva de stock`);
            break;
          }
          default:
            // Events from other services not handled here — ignore safely
            break;
        }
      } finally {
        client.release();
      }
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[consumer] Job ${job?.id} failed:`, err);
  });

  console.log("[consumer] svc-ordenes event consumer started");
}
