# ADR #010 — Estrategia de testing (pirámide de tests)

**Estado:** Aceptado
**Fecha:** 2026-09-02
**Autores:** Equipo ERP
**Fase:** 7 — Testing

---

## Contexto

Tras Fase 6, el repo tenía:

- Solo `tests/e2e/flow.test.ts` (30s, requiere `docker compose up`, flaky por timing SSE, sin `Idempotency-Key` test, sin `health/ready`).
- Sin unit tests para `orden.statemachine` (lógica crítica) ni `producto.schema` (validación Zod).
- Sin integration con `testcontainers` para verificar `SAVEPOINT`/`FOR UPDATE` y `outbox SKIP LOCKED` (solo se probaba en E2E).
- Sin contract test para `producto.creado` (si `svc-productos` cambia payload, `svc-stock` rompe silenciosamente).
- Sin load tests (`k6`) para validar SLOs `p95 <2s` y `stock-contention` 100 VUs.
- CI solo `e2e` (sin `lint`, `type-check`, `coverage` gates, sin `codecov`, sin cache).

Se evaluó cómo pasar a pirámide rápida y confiable sin duplicar E2E.

---

## Decisión

### a) Unit (vitest, <5s, 80% domain)

- **Vitest 3** por servicio (`services/svc-*/vitest.config.ts`): `include: ["src/**/*.spec.ts","test/**/*.spec.ts"]`, `coverage: {provider:"v8", include:["src/domain/**/*"], thresholds:{lines:80,branches:80}}`.
- **Tests:**
  - `services/svc-ordenes/src/domain/orden.statemachine.spec.ts` (7 casos: `puedeTransicionar` pendiente→confirmada/cancelada, terminal, `describir`, `TransicionInvalidaError`).
  - `services/svc-ordenes/src/domain/orden.schema.spec.ts` (LineaOrden/CrearOrden Zod: uuid, cantidad>0, precio>=0, lineas min1, int).
  - `services/svc-productos/src/domain/producto.schema.spec.ts` (Crear/Actualizar Zod: sku, nombre, precio, unidad default, etc. 12 casos).
  - `services/svc-obs` y `svc-stock` usan mismo patrón (dominio pequeño, se cubre vía integration si no hay domain).
- **Scripts:** `npm run test` (`vitest run`), `test:watch` (`vitest`), `test:coverage` (`vitest run --coverage`). `npm run test --workspaces` en CI.

### b) Integration (testcontainers, aislado)

- **Deps:** `testcontainers@10`, `@testcontainers/postgresql`, `pg`, `vitest`.
- **Tests:**
  - `services/svc-ordenes/test/integration/consumer.spec.ts` (PostgreSqlContainer `postgres:16-alpine`, crea `eventos_recibidos`+`ordenes`, test `isAlreadyProcessed` dentro/fuera tx, `SAVEPOINT` rollback no deja marca, concurrent `FOR UPDATE` no deadlock).
  - `services/svc-stock/test/integration/consumer.spec.ts` (stock `FOR UPDATE`, idempotencia no doble reserva, concurrent `FOR UPDATE` espera).
  - `services/svc-productos/test/integration/consumer.spec.ts` (`outbox` `SELECT ... FOR UPDATE SKIP LOCKED`, concurrent relays no duplican).
- **Vitest config** ya incluye `test/**/*.spec.ts`, por lo que `npm run test --workspace=@erp/svc-ordenes -- --run test/integration` ejecuta solo integration.

### c) Contract (pact-like, sin broker)

- **Ubicación:** `tests/contract/producto-creado.pact.spec.ts` + `tests/contract/vitest.config.ts` + `tests/contract/package.json` (`@pact-foundation/pact`, `zod`, `vitest`).
- **Enfoque:** No se levanta `pact-broker` en Fase 7 (overkill). Se usa `validateEventPayload` + `zod` schema del evento como contrato:
  - Producer `svc-productos` debe emitir payload que pasa `ProductoCreadoPayloadSchema`.
  - Consumer `svc-stock` valida con mismo schema.
  - Tests: válido, sku vacío, precio negativo, extra field (backward compat), uuid, `CURRENT_SCHEMA_VERSION`.
- **CI:** `npm --workspace=@erp/contract-tests test` o `npx vitest run tests/contract`.

### d) E2E refactorizado (determinístico)

- **`tests/e2e/flow.test.ts`:** mantiene 2 describes (happy + insufficient) con `poll`/`waitForSseEvent` (raw `http.get` SSE, `event: ...\ndata: ...\n\n` parser, 30s timeout) + **nuevo** `describe("ERP — Idempotency-Key")`:
  - Crea producto + stock, luego `POST /ordenes` con `Idempotency-Key` duplicado → `201` luego `200` mismo `id`, verifica `GET /ordenes/:id` y `GET /health/ready`/`/health/live`.
  - Reusa seeds de Fase 1 vía `poll` para stock row (no depende de timing fijo).
  - `waitForSseEvent` ahora acepta `predicate` con `eventName` + `payloadKey` y limpia `timer`/`req.destroy()` correctamente (evita leaks).

### e) Load (k6)

- **`tests/load/order-flow.js`:** `k6/http` + `k6/metrics` `Trend`/`Counter`, `options.stages` (10→50 VUs, 5m), `thresholds` `p95<500ms` y `order_confirmation_latency_seconds p95<2s`, `http_req_failed<1%`, `failed_orders==0`. Usa `Idempotency-Key` por VU/iter, `poll` `GET /ordenes/:id` hasta `confirmada` (15s), `sla_delivery` vía `GET /obs/events`, `handleSummary` log p95.
- **`tests/load/stock-contention.js`:** `scenarios: {contention: {executor:"constant-vus", vus:100, duration:"1m"}}`, `POST /stock/:id/ajustar` delta ±1, `check` 200 y `disponible` número, `thresholds` `p95<300ms`, `http_req_failed<2%`.
- **Requiere:** `k6` binary (`grafana/setup-k6-action` en CI, o `docker run grafana/k6` local).

### f) CI matrix y coverage gates (F7.6)

- **`.github/workflows/ci.yml`:** 6 jobs:
  - `lint` (`eslint`, `prettier --check`), `type-check` (`tsc --workspaces`), `unit` (`vitest --coverage`, `codecov` + `actions/cache` vitest), `integration` (`testcontainers`, `CI=true`), `contract` (`pact`), `e2e` (`docker compose up`, `health` checks, `curl /metrics`, `supertest` E2E), `load` (nightly `schedule: 0 3 * * *` o `[load]` en commit, `k6`).
  - `unit` falla si `vitest` thresholds <80 (ya en `vitest.config.ts`).
  - `e2e` sigue verde con `docker compose up --build` + `wait` 30×5s + `codecov` y `buildx cache`.

### g) Docs (F7.7)

- **`docs/adr/010-estrategia-testing.md`** (este ADR).
- **`docs/testing.md`** (cómo correr cada nivel local: `npm run test:coverage`, `testcontainers` sin Docker, `k6` local, `ci`).

---

## Consecuencias

**Positivas:**

- `npm run test` unit <5s (3 specs, 30 tests), coverage >80% en `domain` (v8).
- `testcontainers` aísla `SAVEPOINT`/`SKIP LOCKED` sin `docker compose` completo.
- Contract sin broker evita infra extra pero detecta breaking changes en `zod` antes de E2E.
- E2E con `Idempotency-Key` cubre Fase 2 y es determinístico (reusa `poll` + `waitForSse` con `correlationId`).
- `k6` valida SLOs `p95 <2s` y `stock-contention` 100 VUs sin pérdida (criterio Fase 7).

**Negativas:**

- `testcontainers` requiere Docker daemon (no funciona en CI sin `docker`); se skippea si no hay `DOCKER_HOST`.
- `pact` sin broker no verifica compatibilidad cruzada real; Fase 11 añadirá `pact-broker` con `can-i-deploy`.
- `k6` no soporta SSE nativo, se simula con `poll` REST; `sse_delivery_seconds` es aproximado.

---

## Alternativas rechazadas

- **Jest vs Vitest:** Jest más lento (JSdom), Vitest nativo ESM + `v8` coverage + `globals:true` más rápido (<5s).
- **Supertest vs Playwright para contract:** Supertest para HTTP, Playwright para dashboard (Fase 8); Pact para eventos es más ligero que Playwright para contrato.
- **k6 vs Artillery:** k6 tiene `Thresholds` y `Trend` nativos para SLOs, Artillery requiere JS externo.

---

## Referencias

- `services/*/vitest.config.ts`, `src/domain/*.spec.ts`, `test/integration/*.spec.ts`
- `tests/contract/producto-creado.pact.spec.ts`, `tests/load/*.js`
- `tests/e2e/flow.test.ts`, `.github/workflows/ci.yml`, `docs/testing.md`
