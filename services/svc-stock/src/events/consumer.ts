import { Worker } from "bullmq";
import type { DomainEvent, OrdenCreadaPayload, OrdenCanceladaPayload } from "@erp/shared-types";
import { pool } from "../db/pool.js";
import { publishEvent } from "./publisher.js";

const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export function startEventConsumer(): void {
  const worker = new Worker<DomainEvent>(
    "domain-events",
    async (job) => {
      const event = job.data;

      const client = await pool.connect();
      try {
        // Idempotency check
        const { rows: seen } = await client.query(
          "SELECT event_id FROM eventos_recibidos WHERE event_id = $1",
          [event.id]
        );
        if (seen.length > 0) {
          console.log(`[consumer] Skipping duplicate event ${event.id}`);
          return;
        }

        await client.query(
          "INSERT INTO eventos_recibidos (event_id, nombre_evento) VALUES ($1, $2)",
          [event.id, event.name]
        );

        switch (event.name) {
          case "orden.creada": {
            const { orden } = event.payload as OrdenCreadaPayload;
            await client.query("BEGIN");
            try {
              for (const linea of orden.lineas) {
                // Ensure stock row exists (upsert)
                await client.query(
                  `INSERT INTO stock (producto_id, sku, disponible, reservado)
                   VALUES ($1, $2, 0, 0)
                   ON CONFLICT (producto_id) DO NOTHING`,
                  [linea.productoId, linea.sku]
                );

                const { rows } = await client.query(
                  "SELECT disponible FROM stock WHERE producto_id = $1 FOR UPDATE",
                  [linea.productoId]
                );

                if (rows.length === 0 || rows[0].disponible < linea.cantidad) {
                  await client.query("ROLLBACK");
                  console.warn(
                    `[consumer] Stock insuficiente para ${linea.sku} (orden ${orden.id})`
                  );
                  // Emit cancellation event for the order
                  await publishEvent("orden.cancelada", {
                    ordenId: orden.id,
                    motivo: `Stock insuficiente para SKU ${linea.sku}`,
                  });
                  return;
                }

                await client.query(
                  `UPDATE stock
                   SET disponible = disponible - $1,
                       reservado  = reservado  + $1,
                       actualizado_en = NOW()
                   WHERE producto_id = $2`,
                  [linea.cantidad, linea.productoId]
                );

                await client.query(
                  `INSERT INTO reservas (orden_id, producto_id, cantidad) VALUES ($1, $2, $3)`,
                  [orden.id, linea.productoId, linea.cantidad]
                );

                await client.query(
                  `INSERT INTO movimientos_stock (producto_id, tipo, delta, referencia_id, motivo)
                   VALUES ($1, 'reserva', $2, $3, $4)`,
                  [linea.productoId, -linea.cantidad, orden.id, `Reserva por orden ${orden.id}`]
                );
              }
              await client.query("COMMIT");

              await publishEvent(
                "stock.reservado",
                {
                  ordenId: orden.id,
                  items: orden.lineas.map((l) => ({
                    productoId: l.productoId,
                    cantidad: l.cantidad,
                  })),
                },
                event.correlationId
              );

              console.log(`[consumer] Stock reservado para orden ${orden.id}`);
            } catch (err) {
              await client.query("ROLLBACK");
              throw err;
            }
            break;
          }

          case "orden.cancelada": {
            const { ordenId } = event.payload as OrdenCanceladaPayload;

            await client.query("BEGIN");
            try {
              const { rows: reservas } = await client.query(
                "SELECT producto_id, cantidad FROM reservas WHERE orden_id = $1 AND estado = 'activa'",
                [ordenId]
              );

              for (const reserva of reservas) {
                await client.query(
                  `UPDATE stock
                   SET disponible = disponible + $1,
                       reservado  = reservado  - $1,
                       actualizado_en = NOW()
                   WHERE producto_id = $2`,
                  [reserva.cantidad, reserva.producto_id]
                );

                await client.query(
                  `INSERT INTO movimientos_stock (producto_id, tipo, delta, referencia_id, motivo)
                   VALUES ($1, 'liberacion', $2, $3, $4)`,
                  [reserva.producto_id, reserva.cantidad, ordenId, `Liberación por cancelación de orden ${ordenId}`]
                );
              }

              await client.query(
                "UPDATE reservas SET estado = 'liberada', liberada_en = NOW() WHERE orden_id = $1",
                [ordenId]
              );

              await client.query("COMMIT");

              await publishEvent("stock.liberado", {
                ordenId,
                items: reservas.map((r) => ({
                  productoId: r.producto_id,
                  cantidad: r.cantidad,
                })),
              });

              console.log(`[consumer] Stock liberado para orden cancelada ${ordenId}`);
            } catch (err) {
              await client.query("ROLLBACK");
              throw err;
            }
            break;
          }

          case "producto.creado": {
            const payload = event.payload as { producto: { id: string; sku: string } };
            await client.query(
              `INSERT INTO stock (producto_id, sku, disponible, reservado)
               VALUES ($1, $2, 0, 0)
               ON CONFLICT (producto_id) DO NOTHING`,
              [payload.producto.id, payload.producto.sku]
            );
            console.log(`[consumer] Stock inicializado para producto ${payload.producto.sku}`);
            break;
          }

          default:
            break;
        }
      } finally {
        client.release();
      }
    },
    { connection, concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[consumer] Job ${job?.id} failed:`, err);
  });

  console.log("[consumer] svc-stock event consumer started");
}
