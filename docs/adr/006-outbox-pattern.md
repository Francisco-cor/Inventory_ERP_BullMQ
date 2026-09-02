# ADR #006 — Outbox transaccional y relay (Event Bus 2.0)

**Estado:** Aceptado
**Fecha:** 2026-09-01
**Autores:** Equipo ERP
**Fase:** 3 — Event Bus 2.0

---

## Contexto

Tras Fase 2, la publicación era no atómica: `services/svc-ordenes/src/routes/ordenes.ts:229` hacía `COMMIT` y luego `publishEvent` (que hacía `eventBus.publish` + `INSERT eventos_emitidos` en conexión separada). Si el proceso crasheaba entre `COMMIT` y `publish`, la orden quedaba `pendiente` sin evento → SLA warning eterno.

Además, `packages/event-bus/src/bus.ts:64` tenía `ALL_SERVICES` hardcodeado, `schemaVersion` solo hacía `console.warn`, y `console.log` mezclado con `pino`. El SSE `broker.ts` no escalaba y no había `Bull Board`.

Se evaluó el patrón Outbox transaccional + relay con `SELECT FOR UPDATE SKIP LOCKED`.

---

## Decisión

**a) Outbox por servicio**

- Tablas `outbox` en 4 servicios (`svc-productos/002_outbox.sql`, `svc-ordenes/003_outbox.sql`, `svc-stock/005_outbox.sql`, `svc-obs/002_outbox.sql`): `id PK`, `nombre_evento`, `payload JSONB`, `correlation_id`, `created_at`, `published_at`, `attempts`, `last_error`, `estado`.
- `migrate.ts` registra nueva migración con `schema_migrations` + `down`.

**b) Publisher transaccional**

- `services/*/src/events/publisher.ts` ahora genera `eventId`/`correlationId`, valida con `validateEventPayload` (`packages/event-bus/src/schemas.ts`), y hace `INSERT INTO outbox` + `eventos_emitidos` en la misma transacción si se pasa `client: PoolClient`; si no, usa `pool` (relay lo publicará).
- Rutas `POST /productos`, `POST /ordenes`, `POST /stock/:id/ajustar` y `PATCH/DELETE` ahora hacen `BEGIN` → `INSERT` → `publishEvent(..., client)` → `COMMIT` (`svc-ordenes/src/routes/ordenes.ts:211`, `svc-productos/src/routes/productos.ts:123`).

**c) Relay worker**

- `services/*/src/jobs/outbox-relay.ts` poll cada `OUTBOX_POLL_INTERVAL_MS` (500ms), `SELECT ... WHERE published_at IS NULL ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED`, reconstruye `DomainEvent` con `id`/`nombre_evento`/`payload`/`correlation_id`/`created_at`/`source`/`CURRENT_SCHEMA_VERSION`, llama `eventBus.publishRaw` (nuevo método que preserva `id`/`timestamp` y hace fan-out a `getAllServices()`), y `UPDATE published_at=NOW(), estado='published'`. En fallo, `attempts+1` + `last_error`.
- `src/index.ts` llama `startOutboxRelay()` tras `registerSecurity` y `stopOutboxRelay()` en `SIGTERM`.

**d) Registry dinámico**

- `packages/event-bus/src/bus.ts:64` `getAllServices()` lee `EVENT_BUS_SERVICES` env (comma-separated) o default; `publish` y `publishRaw` usan `getAllServices()` dinámicamente y crean `Queue` lazy si falta; `registerService()` para `svc-compras` futuro.

**e) Schema registry & version**

- `packages/event-bus/src/schemas.ts` con Zod por cada `EventName` (`ProductoCreado`, `OrdenCreada`, etc.) y `validateEventPayload`.
- `bus.ts` `publish`/`publishRaw` validan antes de encolar; `startWorker` valida al consumir y si `schemaVersion !== CURRENT` → `skippedVersion++` + `warn` JSON sin retry (permanent); si payload inválido → `failed++` + `throw ValidationError` → `permanent` DLQ.

**f) Métricas y logging**

- Contadores `published`/`consumed`/`failed`/`skippedVersion` en `bus.ts` (`getBusMetrics()`), logs JSON estructurados (`{level, service, eventId, msg}`) en `publish`, `publishRaw`, `failed`/`completed`.
- `outbox-relay` loguea `outbox published` / `publish failed` con `outboxId`.

**g) Bull Board**

- `@bull-board/api` + `@bull-board/fastify` en 4 servicios (`package.json`), registro en `src/index.ts` `try { createBullBoard({ queues: [new BullMQAdapter(new Queue("events-svc-*"))], serverAdapter }) }` en `/admin/queues` (protegido, loggea warn si no disponible). Expone DLQ visual y métricas.

**h) Consumer fix**

- `svc-ordenes/src/events/consumer.ts` `isAlreadyProcessed` ahora toma `PoolClient` y corre dentro de `BEGIN` → `COMMIT` (antes fuera de tx, podía perder evento si `UPDATE` fallaba tras `INSERT eventos_recibidos`). `onStockReservado`/`onStockInsuficiente` ahora `BEGIN` → `isAlreadyProcessed(client)` → `UPDATE` → `publishEvent(..., client)` → `COMMIT`.

---

## Consecuencias

**Positivas:**
- **Atomicidad:** `INSERT ordenes` + `INSERT outbox` en misma tx → si publish falla, relay reintenta en <500ms (test de crash pasa).
- **Extensibilidad:** añadir `svc-compras` solo requiere `EVENT_BUS_SERVICES=...,svc-compras` sin recompilar.
- **Validación fail-fast:** payload inválido en `publish` lanza inmediato, no llega a cola.
- **Observabilidad:** `getBusMetrics()` y logs JSON permiten dashboards y alertas; Bull Board en `/admin/queues` para DLQ.
- **Idempotencia correcta:** `svc-ordenes` ya usa `SAVEPOINT` pattern alineado con `svc-stock`.

**Negativas:**
- **Latencia +500ms:** relay poll añade ~250ms media vs publish directo; aceptable para saga `pendiente→confirmada` (<2s req).
- **Outbox crece:** necesita purge job (Fase 4, `DELETE WHERE published_at < NOW() - 90 days`).
- **Relay single-thread:** un `setInterval` por instancia, con `SKIP LOCKED` permite múltiples réplicas sin duplicar.

---

## Alternativas rechazadas

- **Transactional outbox con Debezium/CDC:** requiere Kafka Connect, overkill para 4 servicios; poll es suficiente.
- **Publish directo + `eventos_emitidos` async:** no garantiza at-most-once, ya visto.
- **BullMQ `QueueEvents` para relay:** más complejo que poll; poll es más visible y testeable.

---

## Referencias

- `packages/event-bus/src/bus.ts`, `schemas.ts`, `index.ts`
- `services/*/migrations/*outbox.sql`, `src/db/migrate.ts`
- `services/*/src/events/publisher.ts`, `src/jobs/outbox-relay.ts`, `src/index.ts`
- `services/svc-ordenes/src/events/consumer.ts`, `services/svc-stock/src/events/consumer.ts`
- `docs/threat-model.md` (outbox mitiga tampering)
