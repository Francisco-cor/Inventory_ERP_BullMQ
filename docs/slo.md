# SLOs — Inventory ERP BullMQ

**Versión:** 1.0.0
**Fecha:** 2026-09-02
**Fase:** 6 — Observabilidad

---

## 1. Definición de SLOs

| SLO                       | Indicador (SLI)                                                                          | Objetivo                                         | Ventana | Fuente                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| **Confirmación de orden** | `histogram_quantile(0.95, order_confirmation_latency_seconds)`                           | 99.9% <5s, 95% <2s                               | 5m      | `svc-obs` `order_confirmation_latency_seconds` (desde `event_log` `creada_en` → `resuelta_en`) |
| **Entrega SSE**           | `time(sse event received) - time(event published)`                                       | 99% <1s, 95% <500ms                              | 5m      | `sse_clients` + `events_published_total` vs `events_consumed_total` (obs)                      |
| **Lag del bus**           | `outbox_lag_seconds` y `outbox_pending`                                                  | p95 lag <1s, pending <10                         | 5m      | `outbox_pending{service}`, `outbox_lag_seconds`                                                |
| **Latencia HTTP**         | `histogram_quantile(0.95, http_request_duration_seconds)`                                | p95 <500ms, p99 <1s                              | 5m      | `http_request_duration_seconds_bucket`                                                         |
| **Disponibilidad**        | `sum(rate(http_requests_total{status!~"5.."}[5m])) / sum(rate(http_requests_total[5m]))` | 99.9% (43m/mes downtime)                         | 30d     | Prometheus                                                                                     |
| **DLQ**                   | `increase(events_failed_total[5m])`                                                      | <1% de publicados, 0 permanentes sin acción >24h | 5m      | `events_failed_total` + `/admin/dlq`                                                           |

### Detalle por flujo

- **Flujo feliz:** `POST /api/v1/ordenes` → `order.created` (outbox <500ms) → `stock.reservado` → `order.confirmed` → `SSE` → `event_log`. Latencia total p95 <2s (medido en `tests/load/order-flow.js` con `k6` 50 VUs).
- **Flujo con error:** `stock.insufficient` → `order.cancelled` debe ser <2s igualmente (compensación).
- **SLA warning:** `sla_warnings_total` debe ser 0 en estado estable; >3/5m dispara `SLABreach` alert.

---

## 2. Métricas y queries

### 2.1 Prometheus queries (para Grafana y alertas)

```promql
# p95 confirmación (F6.4 dashboard erp-overview panel 4)
histogram_quantile(0.95, sum(rate(order_confirmation_latency_seconds_bucket[5m])) by (le))

# Lag del bus (panel 5)
outbox_pending{service="svc-ordenes"}
outbox_lag_seconds{service="svc-obs"}

# Error rate (panel 2)
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
  /
sum(rate(http_requests_total[5m])) by (service)

# DLQ growth (alert HighDLQGrowth)
increase(events_failed_total[5m]) > 5

# SLA breach (alert)
increase(sla_warnings_total[5m]) > 3
```

### 2.2 Logs (Loki)

```logql
{service=~"svc-.*"} |= "error" | json | line_format "{{.time}} {{.service}} {{.msg}} correlation={{.correlationId}}"
{service="svc-obs"} |= "order.created" | json | correlationId="..."
```

### 2.3 Traces (Tempo)

- `service.name="svc-ordenes"` → span `POST /api/v1/ordenes` con `traceId` propagado vía `traceparent` (W3C) en `X-Correlation-Id` + `baggage`.
- Buscar en Grafana Explore > Tempo > `TraceQL`: `{resource.service.name="svc-stock" && span.http.method="POST"}`
- Ver en `grafana:3005` → `Explore` → `Tempo` → `Trace ID` desde `X-Correlation-Id` de la orden.

---

## 3. Error budgets

| SLO                    | Budget mensual (43m para 99.9%) | Acción si se quema 50% en 7d                                                           |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| Confirmación <5s 99.9% | 43m                             | Freeze de features, priorizar perf de `stock.reservado` (índice `stock` + `SAVEPOINT`) |
| SSE <1s 99%            | 7h                              | Revisar `SSE_ADAPTER` (memory vs redis) y `nginx proxy_buffering off`                  |
| Disponibilidad 99.9%   | 43m                             | Revisar `circuitBreaker` y `waitForDatabase` jitter                                    |

---

## 4. Dashboards y runbooks

- **Grafana:** `observability/grafana/dashboards/erp-overview.json` (RED + order p95 + outbox + SSE + SLA + DB pool + Loki) y `event-bus.json`.
- **Prometheus:** `observability/prometheus/prometheus.yml` scrapea `/metrics` de `svc-*` + `rules.yml` con 6 alertas.
- **Runbook:** `docs/runbook.md#observabilidad` (levantar stack, ver métricas, traces, logs).
- **ADR:** `docs/adr/009-observabilidad.md`.

---

## 5. Cómo verificar localmente

```bash
# 1. Levantar stack + observabilidad
docker compose up -d
docker compose -f docker-compose.observability.yml up -d

# 2. Generar carga
npm run seed:large --workspace=@erp/svc-productos
k6 run tests/load/order-flow.js  # si existe, o curl loop

# 3. Ver métricas
curl -s http://localhost:3001/metrics | grep http_requests_total
curl -s http://localhost:9090/api/v1/query?query=histogram_quantile(0.95,sum(rate(order_confirmation_latency_seconds_bucket[5m]))by(le))

# 4. Ver Grafana
open http://localhost:3005  # admin/admin
# Dashboard "ERP — Overview" → p95 <2s, lag <1s

# 5. Ver traces
open http://localhost:3005/explore  # Datasource Tempo → buscar traceId de X-Correlation-Id

# 6. Ver logs
curl -G -s "http://localhost:3100/loki/api/v1/query_range" --data-urlencode 'query={service="svc-obs"}' | jq .

# 7. Ver alertas
open http://localhost:9090/alerts
```

**Criterio Fase 6:** Dashboard muestra `order_confirmation_latency_seconds p95 <2s` y `event_bus_lag <1s` en carga 50 VUs; un `traceId` de `POST /api/v1/ordenes` es visible en Tempo/Grafana.

---

## 6. Roadmap

- **F7:** Añadir `k6` thresholds que fallen CI si `p95 >2s`.
- **F11:** Migrar `loki` a S3 y `tempo` a GCS para retención 30d; añadir `Alertmanager` → `svc-notificaciones`.
