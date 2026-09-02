# ADR #005 — Seguridad por capas (edge → app → data)

**Estado:** Aceptado
**Fecha:** 2026-09-01
**Autores:** Equipo ERP
**Fase:** 2 — Seguridad

---

## Contexto

Tras Fase 1, la seguridad era mínima: `ADMIN_API_KEY` opcional (`services/svc-*/src/plugins/auth.ts:10` bypass si no está set), sin `helmet`/`cors` centralizados, sin `JWT`/`RBAC`, sin `Idempotency-Key` para POST, y Nginx sin `rate limiting` ni headers de seguridad (`nginx/nginx.conf`). El sondeo detectó:

- `POST /api/v1/productos` sin `ADMIN_API_KEY` en dev → cualquier cliente escribe.
- `POST /api/v1/ordenes` sin `Idempotency-Key` → retry de cliente crea duplicados.
- Eventos sin validación Zod en consumers → payload malformado va a retry infinito y DLQ sin clasificar.
- Nginx sin `limit_req` → DDoS trivial.
- Swagger expone `productos` vs `products` inconsistente (`README.md:135` vs `src/routes/productos.ts`).

Se evaluaron estrategias para endurecer sin bloquear DX.

---

## Decisión

**a) Edge (Nginx):** `limit_req_zone` (`api:10m rate=10r/s`, `admin:10m rate=5r/s`), `burst 20/10 nodelay` por `location`, `gzip`, headers `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (`nginx/nginx.conf:24`), alias `/api/v1/products` → `svc_productos` y `/api/v1/orders` → `svc_ordenes` para normalizar i18n.

**b) App (Fastify):** Nuevo paquete `@erp/auth` (`packages/auth/src/index.ts`) con:
- `registerSecurity(app)` → `helmet` (`contentSecurityPolicy: false` para Swagger) + `cors` (`origin: true`, `allowedHeaders` incluye `Idempotency-Key`, `X-Api-Key`).
- `requireApiKey`: fail-closed en `production` si `ADMIN_API_KEY` falta (500), bypass en `development` si no está set, 401 si header inválido (`packages/auth/src/index.ts:27`).
- `requireJwt`: si `JWT_SECRET` set, exige `Authorization: Bearer`, verifica `jsonwebtoken`, decora `request.user` con `role` (`admin`/`operador`/`lector`), 401/403 si falla.
- `requireRole(...roles)`: verifica `request.user.role` o `apiKeyValid` como `admin` implícito.
- `requireAuth`: combina JWT (si hay `Authorization`) y ApiKey.

Cada servicio registra `registerSecurity` primero (`services/svc-*/src/index.ts:38`) y `plugins/auth.ts` re-exporta desde `@erp/auth` para compatibilidad.

**c) Validación de env:** `@erp/env` (`packages/env/src/index.ts:22`) exige `ADMIN_API_KEY` en `production` via `superRefine`, añade `JWT_SECRET` (min 16), `.env.example` documenta ambos.

**d) Idempotencia:** `Idempotency-Key` (8–64 chars) en `POST /api/v1/ordenes` y `POST /api/v1/stock/:productoId/ajustar`:
- Migraciones `002_idempotency` (`svc-ordenes`) y `004_idempotency` (`svc-stock`) → `idempotency_keys(key PK, request_hash, response_status, response_body JSONB, expires_at 24h)`.
- Helpers `hashBody` (sha256), `getIdempotent` (422 si mismo key con distinto payload), `saveIdempotent` (`ON CONFLICT DO NOTHING`).
- Header documentado en `schema.headers`; 400 si longitud inválida, 422 si conflicto.

**e) Validación de eventos:** Zod en todos los consumers (`services/svc-*/src/events/consumer.ts`):
- `StockReservadoSchema`, `OrdenCreadaSchema`, etc.; `validateOrThrow` lanza `ValidationError: payload inválido...` → clasificado como `permanent` en DLQ (`packages/event-bus/src/bus.ts:31` `classifyError`).
- `svc-obs` `onAnyEvent` valida que `payload` sea objeto.

**f) OpenAPI:** Alias `products`/`orders` en `src/index.ts:79`, Nginx proxy para ambos, scripts `generate-openapi.sh` + `npm run openapi:generate`, `README.md:189` actualizada.

---

## Consecuencias

**Positivas:**
- **Fail-closed en prod:** sin `ADMIN_API_KEY` en `NODE_ENV=production` → env validation falla + `requireApiKey` 500.
- **Doble auth:** `ApiKey` para servicios internos/CLI, `JWT` para usuarios con RBAC, sin migraciones dolorosas.
- **Idempotencia cliente:** retry con mismo `Idempotency-Key` y body → 201/200 cached, sin duplicar orden ni stock; conflicto detectado 422.
- **Eventos saneados:** payload inválido → `permanent` DLQ, no retry infinito; `getFailedJobStats` distingue `transient`/`permanent`.
- **Edge endurecido:** `limit_req` mitiga brute force, headers mitigan clickjacking/XSS, gzip reduce payload.
- **Alias i18n:** `productos` (ES) y `products` (EN) coexisten, Swagger documenta ambos.

**Negativas:**
- `helmet` sin `CSP: true` para no romper Swagger; en prod con frontend propio se activará `CSP` estricta.
- `Idempotency-Key` requiere storage (1 fila por key, 24h TTL, índice en `expires_at`); necesita purge job futuro (Fase 4).
- `JWT_SECRET` en `.env` no rotado automáticamente; Fase 11 añadirá Vault.

---

## Alternativas rechazadas

- **Solo ApiKey global:** no permite RBAC fino; JWT añade roles sin overkill de OAuth.
- **Idempotencia en Redis:** viable pero Postgres ya está en cada servicio, evita dependencia extra y permite `UNIQUE` + `request_hash` check transaccional.
- **Kong/Apigee como gateway:** sobrekill para 4 servicios; Nginx + Fastify cubren rate limit + auth.

---

## Referencias

- `packages/auth/src/index.ts`, `packages/env/src/index.ts`, `.env.example`
- `services/svc-*/src/index.ts`, `services/svc-*/src/plugins/auth.ts`, `services/svc-*/src/plugins/idempotency.ts`
- `services/svc-ordenes/migrations/002_idempotency.sql`, `services/svc-stock/migrations/004_idempotency.sql`
- `nginx/nginx.conf`, `scripts/generate-openapi.sh`, `package.json:24` `openapi:generate`
- `docs/threat-model.md`
