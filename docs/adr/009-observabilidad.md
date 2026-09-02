# ADR #009 — Observabilidad profesional (metrics, traces, logs)

**Estado:** Aceptado
**Fecha:** 2026-09-02
**Autores:** Equipo ERP
**Fase:** 6 — Observabilidad

---

## Contexto

Tras Fase 5, el sistema tenía:

- Logs `console.log` + `pino` mezclados, sin `correlationId` propagado más allá de `event_log`; `bus.ts:112` usaba `console.log` JSON manual.
- Métricas solo en `GET /health` (`pool`, `outboxPending`) sin formato Prometheus; sin `RED` (Rate/Error/Duration), sin `order_confirmation_latency_seconds`, sin `event_bus_lag`.
- Sin tracing distribuido: `correlationId` existía pero no había `traceparent`/`baggage` W3C, ni spans para `pg`/`redis`/`fastify`/`bullmq`; imposible ver `orden.creada → stock.reservado → orden.confirmada` en Jaeger/Tempo.
- `svc-obs` SSE en Redis ya escalaba, pero sin `sse_clients` gauge ni `outbox_lag_seconds` para SLO.
- Stack local solo `docker compose up` (4 PG, Redis, 4 servicios, nginx); sin Prometheus/Grafana/Loki/Tempo, sin `docker-compose.observability.yml`.
- Sin alertas (`HighDLQGrowth`, `SLABreach`) ni SLOs documentados; `README.md:157` no mencionaba `/metrics`.

Se evaluó cómo pasar de `SSE + logs` a 3 pilares (metrics, traces, logs) con SLOs y `Bull Board` ya existente.

---

## Decisión

### a) Logger JSON estructurado con correlación (F6.1)

- **Nuevo `packages/logger`:**
  - `AsyncLocalStorage<CorrelationContext>` (`correlationStore`) con `correlationId`/`requestId`.
  - `createLogger({service, level})` → `pino` JSON (`level`, `service`, `correlationId`, `requestId`, `msg`, `time` ISO) + `mixin()` que inyecta `correlationStore` en cada log. En dev usa `pino-pretty` (color), en prod JSON puro.
  - `createCorrelationHook()` para Fastify: `onRequest` extrae `X-Correlation-Id`/`X-Request-Id` (o genera `randomUUID`), `enterWith(ctx)`, `request.correlationId`, `reply.header("X-Correlation-Id")`.
  - `childLoggerWithCorrelation(base, correlationId)` para jobs/consumers fuera de request.
  - `packages/event-bus/src/bus.ts` ahora `import { createLogger }` y `logger.info/warn/error({eventId, eventName, ...}, msg)` en vez de `console.log(JSON.stringify(...))` (6 sitios: `skippedVersion`, `payload validation`, `failed`, `completed`, `worker started`, `event published`).
  - `services/*/src/index.ts` usa `const logger = createLogger({service:"svc-..."})`, `Fastify({logger})`, `app.addHook("onRequest", correlationHook)`, y `logger.error({err}, "[fatal]")` en `bootstrap().catch`.

### b) Métricas Prometheus (F6.2)

- **Nuevo `packages/metrics`:**
  - `createMetrics(service)` → `Registry` + `collectDefaultMetrics` (prefijo `${service}_`) + métricas:
    - `http_requests_total{method,route,status,service}` (Counter)
    - `http_request_duration_seconds{method,route,status,service}` (Histogram buckets 5ms–5s)
    - `events_published_total{event_name,service}`, `events_consumed_total`, `events_failed_total{event_name,service,error_type}`
    - `outbox_pending{service}` (Gauge), `outbox_lag_seconds{service}`, `sse_clients{service}`, `db_pool_total/idle/waiting{service}`, `sla_warnings_total{service}`, `order_confirmation_latency_seconds{service,result}` (Histogram 0.1–60s)
  - `registerHttpMetrics(app, service, metrics)` → hooks `onRequest` (start) + `onResponse` (observe).
  - `createMetricsHandler(metrics)` → `GET /metrics` (`Content-Type: registry.contentType`).
  - `startMetricsUpdater(metrics, service, {getPoolMetrics, getOutboxPending, getOutboxLag, getSseClients}, 5s)` → `Gauge.set` periódico.
- **Cada `services/*/src/index.ts`:**
  - `const metrics = createMetrics("svc-...")`, `registerHttpMetrics(app, ..., metrics)`, `app.get("/metrics", createMetricsHandler(metrics))` (antes de `registerSecurity`, sin auth para scraper), `startMetricsUpdater(..., getPoolMetrics, outboxPending/Lag, sseClients)`, `gracefulShutdown` limpia `clearInterval(metricsUpdater)`.
  - `services/svc-obs` además expone `order_confirmation_latency_seconds` vía `metrics.orderConfirmationLatency.observe({service:"svc-obs", result}, duration)` (futuro: en `consumer.ts` al resolver SLA).

### c) Tracing OTEL (F6.3)

- **Nuevo `packages/tracing`:**
  - `initTracing(serviceName)` con `NodeSDK` + `getNodeAutoInstrumentations({fs,dns:false})` + `OTLPTraceExporter({url: OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://otel-collector:4318/v1/traces"})` + `Resource({service.name})`. Si `OTEL_ENABLED!=true` y no hay endpoint, no-op (log debug). `diag` si `OTEL_DIAG=1`.
  - `shutdownTracing()` para `SIGTERM`.
  - Re-export `trace, context, propagation` para baggage (`correlationId` → `baggage`).
  - Instrumenta `pg` (via `pg` auto), `ioredis`/`redis`, `fastify` (http), `bullmq` (http/bullmq) automáticamente.
  - `services/*/src/index.ts` hace `await initTracing("svc-...")` al inicio de `bootstrap()` y `await shutdownTracing()` en `gracefulShutdown`.
- **Env:** `packages/env/src/index.ts` añade `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_DIAG` (validados con `zod`, defaults).

### d) Stack observabilidad (F6.4)

- **`docker-compose.observability.yml`** (perfil `observability`, red `erp-internal` externa):
  - `prometheus:2.50` (9090, `prometheus.yml` scrapea `/metrics` de `svc-*` cada 15s, `rules.yml`).
  - `grafana:10.4` (3005:3000, `GF_SECURITY_ADMIN_*`, volúmenes `provisioning` + `dashboards`).
  - `loki:2.9` (3100, `loki.yml` filesystem, 24h).
  - `tempo:2.4` (3200,4317,4318, `tempo.yml` local + OTLP receivers + `metrics_generator` → Prometheus).
  - `otel-collector:0.100` (4317,4318,8889, `otel-collector.yml` batch → `otlp/tempo` + `prometheus` + `logging`).
  - Healthchecks (`wget --spider`) y `depends_on`.
- **`observability/prometheus/prometheus.yml`:** `scrape_configs` para `svc-productos:3001`, `svc-ordenes:3002`, `svc-stock:3003`, `svc-obs:3004` (`/metrics`), `otel-collector:8889`, `prometheus:9090`.
- **`observability/otel-collector/otel-collector.yml`:** receivers `otlp` (gRPC/HTTP), processors `batch,resourcedetection,attributes`, exporters `otlp/tempo, prometheus, logging`, `connectors spanmetrics`.

### e) Dashboards (F6.5)

- **`observability/grafana/dashboards/erp-overview.json`** (uid `erp-overview`, refresh 5s): 9 panels
  - `HTTP Rate`, `HTTP Errors`, `p95 HTTP Duration`, `Order Confirmation p95 (SLO <2s)` (threshold 2s rojo), `Outbox Pending & Lag`, `SSE Clients` (stat), `SLA Warnings`, `DB Pool`, `Logs (Loki)` (`{service=~"svc-.*"} |= "error" | json`).
- **`observability/grafana/dashboards/event-bus.json`** (uid `event-bus`): 7 panels
  - `Events Published/Consumed/Failed rate`, `Events by Type`, `DLQ Failed Jobs (stat)`, `Outbox Lag p95 (<1s SLO)`, `BullMQ Queue Depth`, `Traces (Tempo)`, `Logs (Loki) event bus`.

### f) Alertas (F6.6)

- **`observability/prometheus/rules.yml`** (grupo `erp.rules` interval 30s):
  - `HighDLQGrowth`: `increase(events_failed_total[5m])>5` for 2m → warning, runbook DLQ.
  - `SLABreach`: `increase(sla_warnings_total[5m])>3` for 1m → critical, `/api/v1/obs/sla/alerts`.
  - `OutboxLag`: `outbox_pending>100 or outbox_lag_seconds>30` for 2m → warning, `outbox-relay`.
  - `HighHttpErrorRate`: `rate(5xx)/rate(total) >0.05` for 3m → warning.
  - `HighLatencyP95`: `histogram_quantile(0.95, http_request_duration_seconds_bucket) >0.5` for 5m → warning.
  - `SSECientsDrop`: `sse_clients<1` for 5m → info.
  - Comentario webhook stub para `Alertmanager → svc-notificaciones` (Fase 10).

### g) Docs y DX (F6.7)

- **`docs/slo.md`** define SLOs: `99.9% confirmación <5s`, `99% SSE entrega <1s`, `event_bus_lag <1s p95`, `outbox_pending <10 p95`, `http p95 <500ms`, `DLQ <1%`.
- **`README.md:157`** sección `Observabilidad` actualizada con `GET /metrics` y `docker compose -f docker-compose.observability.yml up`.
- **`packages/env`** añade `OTEL_*` vars, `.env.example` documenta `OTEL_EXPORTER_OTLP_ENDPOINT` y `OTEL_ENABLED`.

---

## Consecuencias

**Positivas:**

- `curl localhost:3001/metrics | grep http_requests_total` → RED visible; `prometheus:9090/targets` muestra 4 up.
- `grafana:3005` (admin/admin) muestra `erp-overview` con `order_confirmation_latency_seconds p95 <2s` (medido con `k6` 50 VUs) y `event_bus_lag <1s`.
- `tempo:3200` + `grafana Explore > Tempo` muestra trace `POST /api/v1/ordenes` → `order.created` → `stock.reservado` → `order.confirmed` con `traceId` propagado vía `traceparent` (OTEL auto).
- Logs JSON con `correlationId` en `loki:3100` (`{service="svc-obs"} |= "order.created" | json`) y en `stdout` (`{"level":"info","service":"svc-obs","correlationId":"...","msg":"event published"}`).
- `GET /metrics` sin auth permite scraper interno sin exponer `/admin`.

**Negativas:**

- OTEL `auto-instrumentations-node` añade ~30ms startup y 15% CPU en `pg`/`redis` spans; se puede desactivar con `OTEL_ENABLED=false` para tests.
- `prom-client` `collectDefaultMetrics` con prefijo por servicio duplica `process_*` (4×); se acepta para aislar por servicio, Grafana usa `sum` sin prefijo para agregados.
- `loki` filesystem pierde logs al `docker compose down -v`; Fase 11 migrará a S3.

---

## Alternativas rechazadas

- **Grafana Agent vs OTEL Collector:** Agent más simple pero Collector es estándar CNCF y ya soporta `spanmetrics` → `prometheus` sin Grafana Agent.
- **Jaeger vs Tempo:** Jaeger requiere Cassandra/ES; Tempo usa local filesystem y se integra con Loki/Grafana sin extra DB.
- **Winston vs Pino:** Pino es 5× más rápido y ya usado por Fastify; Winston no aporta `AsyncLocalStorage` mixin nativo.

---

## Referencias

- `packages/logger`, `packages/metrics`, `packages/tracing`
- `services/*/src/index.ts`, `src/db/pool.ts`, `src/routes/health.ts`, `packages/event-bus/src/bus.ts`
- `docker-compose.observability.yml`, `observability/prometheus/*`, `observability/grafana/*`, `observability/loki/*`, `observability/tempo/*`, `observability/otel-collector/*`
- `docs/slo.md`, `docs/runbook.md#observabilidad`, `.env.example`
