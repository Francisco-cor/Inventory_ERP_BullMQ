import { EVENTS } from "@erp/event-bus";
import type {
  DomainEvent,
  OrdenCreadaPayload,
  OrdenCanceladaPayload,
} from "@erp/shared-types";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { publishEvent } from "./publisher.js";
import { eventBus } from "./bus.js";

const STOCK_UMBRAL = Number(process.env.STOCK_ALERTA_UMBRAL ?? 10);

// Inserts the event id inside an active transaction so that a rollback also
// reverts the idempotency record, preventing events from being silently
// skipped when the surrounding transaction failed and the job is retried.
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

// orden.creada → intentar reservar stock
async function onOrdenCreada(event: DomainEvent<OrdenCreadaPayload>): Promise<void> {
  const { orden } = event.payload;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Idempotency check runs inside the transaction so a later ROLLBACK also
    // rolls back this record, letting the job be safely retried on failure.
    if (await isAlreadyProcessed(client, event.id, event.name)) {
      await client.query("COMMIT");
      console.log(`[consumer:stock] Skipping duplicate ${event.id}`);
      return;
    }

    // SAVEPOINT before touching stock rows so we can undo reservation changes
    // on insufficient-stock but still COMMIT the idempotency record.
    await client.query("SAVEPOINT pre_reservation");

    for (const linea of orden.lineas) {
      // Upsert stock row if product not yet known
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
        // Roll back only the stock changes; keep the idempotency record.
        await client.query("ROLLBACK TO SAVEPOINT pre_reservation");
        await client.query("RELEASE SAVEPOINT pre_reservation");
        await client.query("COMMIT");
        console.warn(`[consumer:stock] Stock insuficiente para ${linea.sku} (orden ${orden.id})`);

        await publishEvent(
          EVENTS.STOCK_INSUFICIENTE,
          {
            ordenId: orden.id,
            sku: linea.sku,
            disponible: rows[0]?.disponible ?? 0,
            requerido: linea.cantidad,
          },
          event.correlationId
        );
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

    await client.query("RELEASE SAVEPOINT pre_reservation");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Post-transaction: publish and check alert thresholds independently.
  // These run outside the reservation transaction so a failure here does not
  // cause a spurious ROLLBACK of an already-committed reservation.
  await publishEvent(
    EVENTS.STOCK_RESERVADO,
    {
      ordenId: orden.id,
      items: orden.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad })),
    },
    event.correlationId
  );

  for (const linea of orden.lineas) {
    const { rows: s } = await pool.query(
      "SELECT disponible, sku FROM stock WHERE producto_id = $1",
      [linea.productoId]
    );
    if (s.length > 0 && s[0].disponible < STOCK_UMBRAL) {
      const tipo = s[0].disponible === 0 ? "stock_agotado" : "stock_bajo";
      await pool.query(
        `INSERT INTO alertas_stock (producto_id, sku, nivel_actual, umbral, tipo)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (producto_id) WHERE resuelta = false
         DO UPDATE SET nivel_actual = EXCLUDED.nivel_actual,
                       tipo         = EXCLUDED.tipo,
                       creada_en    = NOW()`,
        [linea.productoId, s[0].sku, s[0].disponible, STOCK_UMBRAL, tipo]
      );
      await publishEvent(
        EVENTS.STOCK_ALERTA,
        { productoId: linea.productoId, sku: s[0].sku, disponible: s[0].disponible, umbral: STOCK_UMBRAL, tipo },
        event.correlationId
      );
    }
  }

  console.log(`[consumer:stock] Stock reservado para orden ${orden.id}`);
}

// orden.cancelada → liberar reservas
async function onOrdenCancelada(event: DomainEvent<OrdenCanceladaPayload>): Promise<void> {
  const { ordenId } = event.payload;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (await isAlreadyProcessed(client, event.id, event.name)) {
      await client.query("COMMIT");
      console.log(`[consumer:stock] Skipping duplicate ${event.id}`);
      return;
    }

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

    if (reservas.length > 0) {
      await publishEvent(
        EVENTS.STOCK_LIBERADO,
        { ordenId, items: reservas.map((r) => ({ productoId: r.producto_id, cantidad: r.cantidad })) },
        event.correlationId
      );
    }

    console.log(`[consumer:stock] Stock liberado para orden cancelada ${ordenId}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// producto.creado → inicializar stock
async function onProductoCreado(
  event: DomainEvent<{ producto: { id: string; sku: string } }>
): Promise<void> {
  const { producto } = event.payload;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (await isAlreadyProcessed(client, event.id, event.name)) {
      await client.query("COMMIT");
      return;
    }

    await client.query(
      `INSERT INTO stock (producto_id, sku, disponible, reservado)
       VALUES ($1, $2, 0, 0)
       ON CONFLICT (producto_id) DO NOTHING`,
      [producto.id, producto.sku]
    );

    await client.query("COMMIT");
    console.log(`[consumer:stock] Stock inicializado para producto ${producto.sku}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function startEventConsumer(): void {
  eventBus.subscribe(EVENTS.ORDEN_CREADA, onOrdenCreada);
  eventBus.subscribe(EVENTS.ORDEN_CANCELADA, onOrdenCancelada);
  eventBus.subscribe(EVENTS.PRODUCTO_CREADO, onProductoCreado);
  eventBus.startWorker();
}
