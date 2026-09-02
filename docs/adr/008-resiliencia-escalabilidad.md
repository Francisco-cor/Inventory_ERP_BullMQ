# ADR #008 — Resiliencia y escalabilidad horizontal

**Estado:** Aceptado
**Fecha:** 2026-09-02
**Autores:** Equipo ERP
**Fase:** 5 — Resiliencia y Escalabilidad Horizontal

---

## Contexto

Tras Fase 4, el sistema era funcional pero no escalable:

- `services/svc-obs/src/sse/broker.ts:5` usaba `Map<clientId, ServerResponse>` en memoria → al escalar `svc-obs` a 2 réplicas tras nginx, cada cliente solo veía eventos de su réplica (pérdida ~50% con `docker compose up --scale svc-obs=2`).
- `services/*/src/index.ts:122` `SIGTERM` solo hacía `app.close()/pool.end()` sin `stop accepting + drain` ni `closeAllConnections()`, sin timeout de 10s → conexiones SSE cortadas abruptamente, BullMQ jobs huérfanos.
- `services/*/src/db/pool.ts:33` `waitForDatabase` con `delayMs` fijo 2000ms sin jitter → thundering herd si 4 servicios reinician a la vez; sin `circuitBreaker`, `pool.query` saturado propaga fallo en cascada.
- `docker-compose.yml` sin `deploy.resources.limits`, sin `read_only`, sin `security_opt` → un servicio podía consumir todo el host.
- `nginx/nginx.conf:177` solo tenía `/health/productos` etc, sin `/health` agregado → orquestador no podía hacer liveness global.
- Sin chaos test, sin plan de escalado documentado.

Se evaluó cómo permitir `docker compose up --scale svc-obs=2` y `chaos kill-stock` sin pérdida.

---

## Decisión

### a) SSE con Redis PubSub adapter (F5.1)

- **Nuevo `services/svc-obs/src/sse/broker.ts`:**
  - `clients: Map<string, ServerResponse>` se mantiene **por réplica** (local).
  - `initSseBroker({host, port})` lee `SSE_ADAPTER` env (`memory|redis`, default `memory`). Si `redis`, crea `pub` y `sub` con `ioredis` (`lazyConnect`, `maxRetriesPerRequest:2`), `sub.subscribe("sse:broadcast")`, y `sub.on("message", (CHANNEL, msg) => localBroadcast(...))`.
  - `broadcast(eventType, data)` ahora es `async`:
    - `memory`: `localBroadcast(eventType, data)` (comportamiento previo, usado en dev y tests sin Redis).
    - `redis`: `await pub.publish(CHANNEL, JSON.stringify({eventType, data}))`; todas las réplicas (incluida la que publicó) reciben vía `sub` y hacen `localBroadcast`. Si `publish` falla, fallback a `localBroadcast`.
  - `closeSseBroker()` hace `pub.quit()` + `sub.quit()` para graceful shutdown.
  - `getSseAdapter()` expone modo para `/health`.
  - Dependencia `ioredis@5.4` añadida a `services/svc-obs/package.json` y `@erp/resilience` a los 4 servicios (para `waitForDatabase` jitter).
  - `services/svc-obs/src/events/consumer.ts:75` `storeAndBroadcast` ahora `await broadcast(...)`.
  - `services/svc-obs/src/index.ts:33` llama `await initSseBroker({host: REDIS_HOST, port: REDIS_PORT})` antes de `registerSecurity`.

**Tradeoff:** Redis PubSub añade latencia ~2–5ms y hop extra, pero permite N réplicas sin pérdida; se conserva flag `SSE_ADAPTER` para rollback instantáneo a `memory` (`SSE_ADAPTER=memory docker compose up`).

### b) Graceful shutdown 10s + drain (F5.2)

- **Cada `services/*/src/index.ts`:**
  - `export let isShuttingDown = false` (o `state.ts` en `svc-obs` para evitar ciclo con `health-aggregate`).
  - `gracefulShutdown(signal)` con `stop_grace_period:15s` en compose:
    1. `setShuttingDown(true)` (para que `/health/ready` devuelva 503).
    2. `setTimeout(forcedExit, 10_000).unref()`.
    3. `await stopOutboxRelay()` / `stopRetentionJob()` / `stopSlaChecker()` (obs) con `.catch`.
    4. `await closeSseBroker()` (obs).
    5. `await app.close()` (Fastify stop accepting).
    6. `(app.server as any).closeAllConnections?.()` / `closeIdleConnections?.()`.
    7. `await eventBus.close()` (cierra Worker + Queues).
    8. `await pool.end()`.
    9. `clearTimeout` + `process.exit(0)`.
  - Handlers `SIGTERM`, `SIGINT`, `SIGUSR2` (`nodemon`) apuntan a `gracefulShutdown`.
  - `docker-compose.yml` `stop_grace_period:15s` da 5s de margen sobre los 10s de app.

### c) Circuit breaker + retry jitter (F5.3)

- **Nuevo `packages/resilience`:**
  - `exponentialBackoffMs(attempt, base, max, factor, jitterFactor)` + `retryWithJitter(fn, {retries, baseDelayMs, maxDelayMs, jitterFactor, factor})` y `waitForWithJitter`.
  - `CircuitBreaker` con estados `closed/open/half_open`, `failureThreshold:5`, `resetTimeoutMs:10_000`, `halfOpenMaxCalls:2`, `CircuitOpenError`.
  - `createBreaker()` helper.
- **Pool:** `services/*/src/db/pool.ts` ahora `import { waitForWithJitter, CircuitBreaker } from "@erp/resilience"`, `export const dbBreaker = new CircuitBreaker(...)`, `waitForDatabase(retries, baseDelayMs)` usa `waitForWithJitter(async () => { pool.connect(); SELECT 1 }, retries, baseDelayMs, 5000)` (jitter 0.25, factor 1.8) → evita thundering herd.
  - `getPoolMetrics()` expone `breakerState`.
  - `tsconfig.json` de los 4 servicios añade referencia a `packages/resilience`.

### d) Hardening Docker (F5.4)

- **`docker-compose.yml` para los 4 servicios Node:**
  - `read_only: true`, `tmpfs: ["/tmp:rw,noexec,nosuid,size=100m"]`, `security_opt: ["no-new-privileges:true"]`.
  - `deploy.resources.limits: {cpus:'1.0', memory:512M}` + `reservations: {cpus:'0.25', memory:256M}` + `mem_limit:512m`, `cpus:1.0`, `stop_grace_period:15s`.
  - `svc-obs` env añade `SSE_ADAPTER: redis` y `HEALTH_AGGREGATE_TIMEOUT_MS:2000`.
- **`services/*/Dockerfile`** ya tenía `USER node` + `dumb-init`; no requiere cambio en esta fase (Helm futuro añadirá `readOnlyRootFilesystem`).

### e) Health agregado y readiness (F5.5)

- **`services/svc-obs/src/routes/health-aggregate.ts` (nuevo):**
  - `GET /health/aggregate` → paralelo: `pool.query("SELECT1")`, `eventBus.ping()`, `fetch(http://svc-productos:3001/health)`, `fetch(http://svc-ordenes:3002/health)`, `fetch(http://svc-stock:3003/health)` con `AbortController` timeout 2s (`HEALTH_AGGREGATE_TIMEOUT_MS`). Respuesta `{status:"ok"|"degraded", services:{svc-obs:{db,redis,sseClients,sseAdapter,pool}, svc-productos:{status,httpCode,latencyMs}, ...}, isShuttingDown, latencyMs}`. `200` si todos `ok` y no draining, `503` si alguno falla.
  - `GET /health/ready` → solo self `SELECT1` + `ping` + `!isShuttingDown`; para K8s `readinessProbe`.
  - `GET /health/live` → `{status, uptime, isShuttingDown}`; para `livenessProbe`.
  - `services/svc-obs/src/state.ts` guarda `isShuttingDown` compartido entre `index.ts` y `health-aggregate.ts` (evita ciclo).
  - `services/svc-productos|ordenes|stock/src/routes/health.ts` añade `GET /health/ready` y `/health/live` (mismo criterio sin flag global).
- **`nginx/nginx.conf:176`:** añade `location = /health { proxy_pass http://svc_obs/health/aggregate; }`, `= /health/ready`, `= /health/live`, `= /health/nginx` (self). Mantiene `/health/productos|ordenes|stock|obs` legados.
- **`docker-compose.yml` healthchecks** siguen usando `/health` individual (rápido); `/health` agregado es para orquestador externo.

### f) Chaos y runbook (F5.6)

- **`tests/chaos/kill-stock.sh`:** mata `svc-stock` 8s mid-saga (`docker compose kill svc-stock`), verifica que `/health` no sea 502, espera `healthy`, y hace `GET /api/v1/ordenes/:id` polling 20s hasta `confirmada|cancelada` (resiliencia outbox). Criterio: ~100% órdenes deben terminar no-pendientes; falla si quedan `pending`.
- **`docs/runbook.md`** añade sección _Escalado Horizontal_ y _Chaos_.
- **Verificación manual para F5:** `docker compose up --scale svc-obs=2 -d` + abrir 2 tabs `curl -N http://localhost/api/v1/obs/events/stream` + `POST /api/v1/ordenes` → ambos streams deben ver `order.created → stock.reserved → order.confirmed` (fan-out Redis).

---

## Consecuencias

**Positivas:**

- `docker compose up --scale svc-obs=2` entrega SSE sin pérdida (medido con `k6` 100 VUs, ver `docs/runbook.md`).
- Caída de `svc-stock` 8s no bloquea saga: outbox reintenta (<500ms poll + jitter) y orden termina `confirmada` al volver (chaos test pasa).
- `GET /health` global permite `nginx`/`docker`/`k8s` liveness único; `GET /health/ready` evita mandar tráfico a réplica en `draining`.
- Hardening reduce superficie: `read_only` + `no-new-privileges` bloquea escritura accidental y escalada.

**Negativas:**

- `ioredis` añade ~1.5MB y dos conexiones persistentes por réplica `svc-obs`; aceptable vs `nginx` upstream que ya multiplexa.
- PubSub con `ioredis` no persiste: si todas las réplicas caen, cliente SSE pierde eventos hasta reconectar (mitigado por `EventLog` `GET /api/v1/obs/events/stream` que envía 50 eventos recientes al conectar).
- `waitForDatabase` con jitter puede tardar hasta ~8s en peor caso vs 2s fijo; para `retries=20` en `svc-obs` es aceptable en cold start.

---

## Alternativas rechazadas

- **BullMQ QueueEvents para SSE:** requiere `ioredis` igualmente y semántica de `QueueEvents` es para jobs, no para fan-out genérico; PubSub nativo es más simple.
- **SSE con Redis Streams:** persistente pero añade complejidad de consumer groups; no requerido para dashboard observabilidad (event_log ya persiste en PG).
- **K8s HPA/PDB ya en Fase 5:** se pospone a Fase 11 (Helm); `deploy.resources` en compose es solo para paridad local.

---

## Referencias

- `services/svc-obs/src/sse/broker.ts`, `src/routes/health-aggregate.ts`, `src/state.ts`, `src/index.ts`, `src/events/consumer.ts`
- `services/*/src/db/pool.ts`, `src/routes/health.ts`, `src/index.ts`
- `packages/resilience/src/index.ts`
- `docker-compose.yml`, `nginx/nginx.conf`
- `tests/chaos/kill-stock.sh`, `docs/runbook.md#escalado-horizontal`
