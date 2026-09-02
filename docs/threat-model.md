# Threat Model — Inventory ERP BullMQ

**Fecha:** 2026-09-01
**Fase:** 2
**Alcance:** 4 servicios (productos, ordenes, stock, obs), Redis/BullMQ, Postgres, Nginx, Dashboard

---

## 1. Actores y Trust Boundaries

| Actor                      | Acceso           | Confianza                                         |
| -------------------------- | ---------------- | ------------------------------------------------- |
| Cliente anónimo (internet) | Nginx :80        | No confiable                                      |
| Operador dashboard         | SSE + REST       | Parcial (requiere credenciales en prod)           |
| Servicio interno (svc-*)   | Redis, PG propio | Confiable dentro de `erp-internal` network        |
| Admin DLQ                  | `GET /admin/*`   | Privilegiado (requiere `X-Api-Key` o JWT `admin`) |

Trust boundary principal: **Nginx** (edge) → **Fastify** (app) → **PG/Redis** (data). Todo lo que cruza boundary se valida.

---

## 2. STRIDE — Amenazas y mitigaciones (Fase 2)

### S — Spoofing (suplantación)

| Amenaza                                  | Mitigación Fase 2                                                                           | Pendiente                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| Llamar `POST /ordenes` suplantando admin | `requireApiKey` fail-closed en prod (`@erp/auth`), `JWT` con `role`                         | Rotación de keys via Vault (Fase 11) |
| Suplantar evento `stock.reservado`       | Redis en `erp-internal` aislado, no expuesto; validación Zod rechaza payload spoof          | mTLS entre servicios (Fase 11)       |
| Suplantar `X-Correlation-Id`             | Nginx genera `$request_id` si falta; `correlationId` se propaga pero no se confía para auth | —                                    |

### T — Tampering (manipulación)

| Amenaza                                               | Mitigación                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Manipular `precioUnitario` en `POST /ordenes`         | `CrearOrdenSchema` (Zod) valida `precioUnitario >=0`, `cantidad >=1`; `hashBody` para idempotency detecta cambio |
| Replay con mismo `Idempotency-Key` pero body distinto | `getIdempotent` compara `request_hash` (sha256), 422 si difiere                                                  |
| Manipular `delta` en `POST /stock/ajustar`            | `stock.ts:157` check `disponible+delta >=0`, `FOR UPDATE` evita race                                             |
| Tamper headers `X-Api-Key`                            | `requireApiKey` compara exacto, `helmet` añade `X-Content-Type-Options: nosniff`                                 |

### R — Repudiation (no repudio)

| Amenaza                             | Mitigación                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Operador niega haber ajustado stock | `movimientos_stock` registra `tipo`, `delta`, `motivo`, `creado_en`; `audit_log` futuro (Fase 10) |
| Orden creada sin traza              | `eventos_emitidos`, `event_log` con `eventId`, `correlationId`, `emitido_en` (obs)                |

### I — Information Disclosure

| Amenaza                                      | Mitigación                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Exposición de `DATABASE_URL`/`ADMIN_API_KEY` | `.env` gitignored, `.env.example` con placeholders; `@erp/env` no loggea secrets (replace `:***@`)                |
| Swagger expone internals                     | `registerSwagger` solo en `/docs`, Nginx no expone sin auth? Actualmente público; Fase 11 restringirá por `admin` |
| Error 500 filtra stack                       | `app.setErrorHandler` retorna `InternalServerError` genérico, loggea con `pino` interno                           |

### D — Denial of Service

| Amenaza                   | Mitigación                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Flood `POST /ordenes`     | Nginx `limit_req zone=api 10r/s burst 20`, Fastify `rateLimit 200/min`                                     |
| Flood `/admin/dlq`        | Nginx `zone=admin 5r/s burst 10`                                                                           |
| SSE connections infinitas | `svc-obs` `broadcast` con `try/catch`, `proxy_read_timeout 86400s`, Fase 5 añadirá Redis adapter + límites |

### E — Elevation of Privilege

| Amenaza                                | Mitigación                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lector` intenta `POST /stock/ajustar` | `requireRole('admin','operador')` (futuro, ahora solo `requireApiKey`/`requireJwt`); `requireRole` ya implementado en `@erp/auth` para Fase 9/10 |
| JWT con `role: admin` falsificado      | `jsonwebtoken.verify` con `JWT_SECRET`; secret min 16 chars validado en `@erp/env`                                                               |

---

## 3. Flujos críticos auditados

- **Crear orden:** `POST /ordenes` → `Idempotency-Key` → `requireApiKey` → `FOR UPDATE` stock → `publish orden.creada` → `stock.reservado` → `orden.confirmada`. Mitiga duplicados, race, tamper.
- **Ajustar stock:** `POST /stock/:id/ajustar` → `Idempotency-Key` → `SELECT ... FOR UPDATE` → `disponible+delta >=0` → `event stock.ajustado` → `alerta` si `<10`. Mitiga negativo y flood.
- **Admin DLQ:** `GET /admin/dlq` → `requireApiKey` + `requireRole('admin')` (cuando JWT activo) → `limit_req admin` → `getFailedJobs`.

---

## 4. Riesgos residuales (para Fase 3+)

- **Secretos en `docker-compose.yml` plaintext** → Vault/ExternalSecrets (Fase 11)
- **Sin `Content-Security-Policy` estricta** (deshabilitada para Swagger) → activar al tener frontend CSP nonce (Fase 8)
- **Sin `audit_log` humano** (quién hizo qué) → `audit_log` con `actor` de `x-user-id` (Fase 10)
- **Eventos sin firma** → `HMAC` por evento si Redis se comparte (Fase 3)
- **Purge `idempotency_keys`/`event_log` no automático** → job de retención (Fase 4)

---

## 5. Checklist Fase 2

- [x] `ADMIN_API_KEY` requerido en prod, `JWT_SECRET` opcional con RBAC scaffold
- [x] `helmet` + `cors` en todos los servicios, Nginx rate limit + headers
- [x] `Idempotency-Key` en ordenes/stock con migración y 422 conflicto
- [x] Zod en consumers → `ValidationError` → `permanent` DLQ
- [x] OpenAPI alias `products`/`orders`, scripts `generate-openapi`

---

## Referencias

- `packages/auth/src/index.ts`, `packages/env/src/index.ts`
- `nginx/nginx.conf`, `services/svc-*/src/plugins/idempotency.ts`
- `docs/adr/005-seguridad-por-capas.md`, `PLAN_IMPLEMENTACION.md` Fase 2
