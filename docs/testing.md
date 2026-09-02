# Testing — Pirámide de tests (Fase 7)

Cómo ejecutar cada nivel localmente. Todos los comandos asumen `npm ci` ya ejecutado.

---

## 1. Unit (vitest, <5s, 80% coverage)

**Qué:** Lógica de dominio pura (`orden.statemachine`, `producto.schema`, `orden.schema`).

**Dónde:** `services/*/src/domain/*.spec.ts`, `vitest.config.ts` por servicio.

```bash
# Todos los workspaces
npm run test --workspaces --if-present
# Uno solo
npm run test --workspace=@erp/svc-ordenes
npm run test --workspace=@erp/svc-productos -- --run src/domain/producto.schema.spec.ts

# Coverage (v8, thresholds 80%)
npm run test:coverage --workspace=@erp/svc-ordenes
# o
npm run test --workspace=@erp/svc-ordenes -- --coverage

# Watch
npm run test:watch --workspace=@erp/svc-ordenes
```

**Criterio:** `lines|branches|functions|statements >=80%` en `src/domain`. Si baja, `vitest` falla y CI bloquea PR.

**Ejemplo output:**

```
✓ src/domain/orden.statemachine.spec.ts (7 tests)
✓ src/domain/orden.schema.spec.ts (6 tests)
✓ src/domain/producto.schema.spec.ts (12 tests)
Coverage: 92% lines, 88% branches
```

---

## 2. Integration (testcontainers, ~10s, requiere Docker)

**Qué:** `isAlreadyProcessed` dentro/fuera de tx, `SAVEPOINT`, `FOR UPDATE`, `SKIP LOCKED`.

**Dónde:** `services/*/test/integration/consumer.spec.ts` (3 archivos), `PostgreSqlContainer` `postgres:16-alpine`.

```bash
# Requiere Docker daemon (docker ps debe responder)
docker ps

# Todos los integration
npm run test --workspace=@erp/svc-ordenes -- --run test/integration
npm run test --workspace=@erp/svc-stock -- --run test/integration
npm run test --workspace=@erp/svc-productos -- --run test/integration

# Uno solo con logs
npm run test --workspace=@erp/svc-ordenes -- --run test/integration/consumer.spec.ts --reporter=verbose
```

**Sin Docker:** los tests se skipean automáticamente si `PostgreSqlContainer` no puede iniciar (CI siempre tiene Docker).

**Qué verifica:**

- `svc-ordenes`: `isAlreadyProcessed` dentro de `BEGIN` → `COMMIT` idempotente, `SAVEPOINT` rollback no deja marca, fuera de tx no pierde evento.
- `svc-stock`: `FOR UPDATE` decrementa, segundo intento idempotente no doble reserva, concurrent `FOR UPDATE` no deadlock.
- `svc-productos`: `outbox` `SKIP LOCKED` permite 2 relays concurrentes sin duplicar.

---

## 3. Contract (pact-like, sin broker, <2s)

**Qué:** `producto.creado` payload Zod + `CURRENT_SCHEMA_VERSION`.

**Dónde:** `tests/contract/producto-creado.pact.spec.ts`, `tests/contract/vitest.config.ts`, `tests/contract/package.json` (`@pact-foundation/pact`).

```bash
# Via workspace @erp/contract-tests (creado por Fase 7)
npm --workspace=@erp/contract-tests test 2>/dev/null || npm run test --workspace=tests/contract 2>/dev/null || npx vitest run tests/contract --run

# Directo
npx vitest run tests/contract --run --reporter=verbose

# Con pact broker futuro (Fase 11):
# npm run test:contract -- --broker --publish
```

**Contrato:**

- Producer `svc-productos` debe emitir `producto: {id:uuid, sku, nombre, precio>=0, unidad}` válido.
- Consumer `svc-stock` debe aceptarlo; sku vacío, precio negativo, uuid inválido → rechazado.
- `CURRENT_SCHEMA_VERSION` debe ser `1.0` (si cambia, pact falla).

---

## 4. E2E (supertest + Docker, ~30s)

**Qué:** Flujo completo feliz + stock insuficiente + Idempotency-Key + health.

**Dónde:** `tests/e2e/flow.test.ts` (3 describes, 10 tests), `tests/e2e/package.json` (`supertest`, `vitest`).

**Requiere:** `docker compose up -d` (4 PG, Redis, 4 servicios, nginx).

```bash
# Levantar (si no está)
docker compose up -d --build
# Esperar health
for SVC in productos ordenes stock obs; do curl -f http://localhost/health/$SVC; done
curl -f http://localhost/health
curl -f http://localhost:3001/metrics | head

# Correr
cd tests/e2e && npm install && npm test
# o desde raíz
npm run test --workspace=tests/e2e

# Con seeds determinísticos (Fase 1)
make seed
# El E2E crea producto SKU=E2E-<timestamp> y stock 20, no depende de seeds previos, pero reusa poll para stock row
```

**Nuevo en Fase 7:**

- `waitForSseEvent` robusto: `http.get` SSE, parser `event: ...\ndata: ...\n\n`, timeout 30s, `req.destroy()` + `clearTimeout` sin leaks, `predicate` con `eventName` + `payloadKey`.
- `Idempotency-Key`: `POST /ordenes` con misma key → `201` luego `200` mismo `id`, verifica `GET /ordenes/:id`.
- `GET /health/ready`/`/health/live` (Fase 5) verificado.

**Troubleshooting:**

```bash
docker compose logs --tail=100 svc-ordenes svc-stock svc-obs
curl -s http://localhost/api/v1/obs/events?eventName=orden.creada&pageSize=5 | jq .
```

---

## 5. Load (k6, 1–5m, genera métricas SLO)

**Qué:** `order-flow` (50 VUs, 2m, p95<2s) y `stock-contention` (100 VUs, 1m).

**Dónde:** `tests/load/order-flow.js`, `stock-contention.js` (k6 `http`, `Trend`, `Counter`, `Thresholds`).

**Requiere:** `k6` binary (`https://k6.io/docs/get-started/installation/` o `docker run grafana/k6`).

```bash
# Instalar k6 (ej. via chocolatey en Windows o brew en Mac)
# Windows: choco install k6
# Mac: brew install k6
# O docker:
# docker run --rm -i --network=host grafana/k6 run - < tests/load/order-flow.js

# Con seed:large para stock suficiente
npm run seed:large --workspace=@erp/svc-productos
# o make seed-large

# Order flow (50 VUs, 2m)
k6 run tests/load/order-flow.js --env ERP_BASE_URL=http://localhost:80
# Con producto específico
k6 run tests/load/order-flow.js --env ERP_BASE_URL=http://localhost:80 --env PRODUCTO_ID=11111111-... --env SKU=SKU-SEED-001

# Stock contention (100 VUs, 1m)
k6 run tests/load/stock-contention.js --env ERP_BASE_URL=http://localhost:80

# Ver thresholds
# order_confirmation_latency_seconds p(95)<2000, http_req_failed<1%, failed_orders==0
```

**Nightly:** `.github/workflows/ci.yml` job `load` corre en `schedule: 0 3 * * *` o si commit contiene `[load]`.

**Métricas SLO (Fase 6):** `order_confirmation_latency_seconds` p95 <2s y `event_bus_lag <1s` deben pasar; si no, `k6` falla y CI marca `load` como failed.

---

## 6. CI (GitHub Actions)

**Archivo:** `.github/workflows/ci.yml` (6 jobs):

- `lint` (`eslint`, `prettier --check`)
- `type-check` (`tsc --workspaces`)
- `unit` (`vitest --coverage`, `codecov`, `actions/cache`, threshold 80%)
- `integration` (`testcontainers`, `docker ps`)
- `contract` (`pact`)
- `e2e` (`docker compose up --build`, `health`, `supertest`, `metrics` check)
- `load` (nightly, `grafana/setup-k6-action`)

**Local equivalente a CI:**

```bash
make type-check && make lint
npm run test --workspaces -- --coverage
npm run test --workspace=@erp/svc-ordenes -- --run test/integration
npx vitest run tests/contract --run
docker compose up -d --build && sleep 5 && cd tests/e2e && npm test
```

**Coverage gates:** `vitest.config.ts` por servicio tiene `thresholds: {lines:80, branches:80}`; si baja, `npm run test -- --coverage` falla (`process.exit(1)`), y CI bloquea PR. Subir a `codecov` con `codecov/codecov-action@v4`.

---

## 7. Troubleshooting común

| Síntoma                           | Causa                                         | Fix                                                                                                                  |
| --------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `PostgreSqlContainer` timeout 60s | Docker no running                             | `docker ps` debe responder; en Windows, `Docker Desktop` debe estar abierto                                          |
| `waitForSseEvent timed out`       | `svc-obs` no recibe eventos (Redis caído)     | `docker compose logs svc-obs redis` ; `curl -N http://localhost/api/v1/obs/events/stream` debe hacer `ping` cada 15s |
| `Idempotency-Key` test flaky      | `idempotency_keys` no limpiada entre E2E runs | `make seed` no limpia, pero E2E usa key única `test-idemp-${Date.now()}` por run                                     |
| `k6` `http_req_failed` >1%        | `STOCK_ALERTA_UMBRAL` o `outbox` lag          | `curl http://localhost:3001/metrics                                                                                  | grep outbox_pending` debe ser <10 |
| `coverage` <80%                   | Nuevo dominio sin tests                       | Añadir `src/domain/*.spec.ts` para nueva lógica                                                                      |

---

## 8. Referencias

- `services/*/vitest.config.ts`, `src/domain/*.spec.ts`, `test/integration/*.spec.ts`
- `tests/contract/producto-creado.pact.spec.ts`, `tests/load/*.js`, `tests/e2e/flow.test.ts`
- `.github/workflows/ci.yml`, `docs/adr/010-estrategia-testing.md`, `docs/testing.md`
- `docs/slo.md` (SLOs p95 <2s, lag <1s)
