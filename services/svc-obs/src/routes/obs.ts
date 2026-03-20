import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { addClient, removeClient } from "../sse/broker.js";

export async function obsRoutes(app: FastifyInstance): Promise<void> {
  // ── SSE stream ─────────────────────────────────────────────────────────────
  app.get("/events/stream", async (req, reply) => {
    const res = reply.raw;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.flushHeaders();

    const clientId = addClient(res);

    // Send recent events so the client has initial data
    try {
      const { rows } = await pool.query(
        `SELECT event_id, event_name, source, correlation_id, payload, emitido_en
         FROM event_log
         ORDER BY emitido_en DESC
         LIMIT 50`
      );
      for (const row of rows.reverse()) {
        res.write(
          `event: event\ndata: ${JSON.stringify({
            eventId: row.event_id,
            eventName: row.event_name,
            source: row.source,
            correlationId: row.correlation_id,
            timestamp: row.emitido_en,
            payload: row.payload,
          })}\n\n`
        );
      }
    } catch {
      // Non-fatal — client will receive live events
    }

    // Keep-alive ping every 15s
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(ping);
      }
    }, 15_000);

    req.raw.on("close", () => {
      clearInterval(ping);
      removeClient(clientId);
    });
  });

  // ── Event log (paginated REST) ─────────────────────────────────────────────
  app.get<{
    Querystring: { page?: string; pageSize?: string; eventName?: string; source?: string };
  }>("/events", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          page:      { type: "string" },
          pageSize:  { type: "string" },
          eventName: { type: "string" },
          source:    { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const page     = Math.max(1, Number(req.query.page     ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50)));
    const offset   = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (req.query.eventName) {
      params.push(req.query.eventName);
      conditions.push(`event_name = $${params.length}`);
    }
    if (req.query.source) {
      params.push(req.query.source);
      conditions.push(`source = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(pageSize, offset);
    const limitClause = `LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT event_id, event_name, source, correlation_id, payload, emitido_en, recibido_en
         FROM event_log
         ${where}
         ORDER BY emitido_en DESC
         ${limitClause}`,
        params
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM event_log ${where}`, params.slice(0, conditions.length)),
    ]);

    return reply.send({
      data: rows.map((r) => ({
        eventId:       r.event_id,
        eventName:     r.event_name,
        source:        r.source,
        correlationId: r.correlation_id,
        payload:       r.payload,
        timestamp:     r.emitido_en,
        recibidoEn:    r.recibido_en,
      })),
      meta: {
        total:      countRows[0]?.total ?? 0,
        page,
        pageSize,
        totalPages: Math.ceil((countRows[0]?.total ?? 0) / pageSize),
      },
    });
  });

  // ── SLA alerts ─────────────────────────────────────────────────────────────
  app.get("/sla/alerts", async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT orden_id, creada_en,
              EXTRACT(EPOCH FROM (NOW() - creada_en))::int AS segundos_pendiente,
              estado_sla
       FROM ordenes_sla
       WHERE estado_sla IN ('pendiente', 'sla_warning')
       ORDER BY creada_en ASC`
    );

    return reply.send({
      data: rows.map((r) => ({
        ordenId:           r.orden_id,
        creadaEn:          r.creada_en,
        segundosPendiente: r.segundos_pendiente,
        estadoSla:         r.estado_sla,
      })),
    });
  });

  // ── Order SLA history ─────────────────────────────────────────────────────
  app.get("/sla/ordenes", async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT orden_id, creada_en, resuelta_en, estado_sla,
              CASE WHEN resuelta_en IS NOT NULL
                   THEN EXTRACT(EPOCH FROM (resuelta_en - creada_en))::int
                   ELSE EXTRACT(EPOCH FROM (NOW() - creada_en))::int
              END AS duracion_segundos
       FROM ordenes_sla
       ORDER BY creada_en DESC
       LIMIT 100`
    );

    return reply.send({
      data: rows.map((r) => ({
        ordenId:          r.orden_id,
        creadaEn:         r.creada_en,
        resueltaEn:       r.resuelta_en,
        estadoSla:        r.estado_sla,
        duracionSegundos: r.duracion_segundos,
      })),
    });
  });
}
