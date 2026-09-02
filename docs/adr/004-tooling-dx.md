# ADR #004 — Tooling y Developer Experience Unificados

**Estado:** Aceptado
**Fecha:** 2026-09-01
**Autores:** Equipo ERP
**Fase:** 1 — Cimientos

---

## Contexto

Tras el sondeo inicial (ver `PLAN_IMPLEMENTACION.md:2`), se detectaron brechas críticas de DX que bloqueaban iteración rápida:

1. `package.json:12` `npm run dev` referencia `docker-compose.dev.yml` inexistente → `dev` roto.
2. Sin linter/formatter → cada PR introduce estilo inconsistente; `console.log` mezclado con `pino` (`packages/event-bus/src/bus.ts:112`).
3. Sin git hooks → commits con mensajes no convencionales y código sin formatear llegan a `main`.
4. Variables de entorno sin validar → `DATABASE_URL` ausente provoca crash tardío en `services/svc-*/src/db/pool.ts:5` sin mensaje claro.
5. Sin Makefile ni scripts unificados → onboarding requiere leer 4 READMEs; `npm run` dispares por workspace (`services/*/package.json:8`).
6. Sin seeds determinísticos → E2E `tests/e2e/flow.test.ts:22` crea SKUs aleatorios `E2E-${Date.now()}`, imposible reproducir fallo localmente.

Se evaluaron alternativas de tooling para cerrar estas brechas sin introducir complejidad innecesaria.

---

## Decisión

**a) Desarrollo con `docker-compose.dev.yml`**

- Override `docker-compose.dev.yml` con `target: deps` + volúmenes bind para hot-reload vía `tsx watch` (`CHOKIDAR_USEPOLLING=true` para Docker en Windows/Mac).
- `dashboard` en modo Vite HMR (`node:20-alpine` + `vite --host 0.0.0.0 --port 3000`) en vez de Nginx build.
- `develop.watch` (Compose v2.22+) para sync sin rebuild.
- Mantener `docker-compose.yml` como base productiva sin cambios.

**b) Lint/Format centralizados en raíz**

- `eslint.config.js` flat config con `typescript-eslint` + `eslint-config-prettier`; `typescript.projectService=true` para type-aware sin `tsconfig` por servicio.
- `.prettierrc.json` (`printWidth 100`, `semi true`) + `.prettierignore` + `.editorconfig` (LF, 2 espacios, final newline).
- Scripts raíz `lint`, `lint:fix`, `format`, `format:check` (`package.json:18`) que reemplazan `npm run lint --workspaces`.

**c) Git hooks con Husky + lint-staged + commitlint**

- `husky` v9 hooks: `pre-commit` → `lint-staged` (eslint --fix + prettier), `commit-msg` → `commitlint` (`@commitlint/config-conventional`).
- `lint-staged` en `package.json` + `.lintstagedrc.json`; `commitlint.config.js` con `type-enum` explícito.
- `prepare: "husky || true"` no rompe en CI sin git.

**d) Validación de env con `@erp/env` (Zod)**

- Nuevo paquete `packages/env` con `BaseEnvSchema` (Zod) que valida `DATABASE_URL` (`postgres://`), `REDIS_HOST/PORT`, `LOG_LEVEL`, `STOCK_ALERTA_UMBRAL`, `SLA_*`, `DB_POOL_MAX`.
- `validateEnv()` fail-fast con mensaje enumerando variables inválidas; `isEnvValid()` para tests.
- Cada servicio expone `src/config.ts` (`import { validateEnv }`) y Dockerfiles copian `packages/env`.
- `.env.example` ampliado con todas las vars documentadas (sección por servicio + `COMPOSE_PROJECT_NAME`).

**e) Makefile + `scripts/dev.sh`**

- `Makefile` con targets `help`, `dev`, `dev-watch`, `up`, `down`, `down-v`, `logs`, `ps`, `build`, `type-check`, `lint`, `format`, `test`, `seed`, `migrate`, `clean`. Unifica comandos dispares de `package.json:11`.
- `scripts/dev.sh` wrapper `sh` para dev con/without `--watch`.

**f) Seeds determinísticos**

- `services/svc-productos/src/seed.ts`: 5 productos con UUIDs fijos `1111...001..005` y SKUs `SKU-SEED-00X`, `ON CONFLICT DO UPDATE`.
- `services/svc-stock/src/seed.ts`: stock `100,50,15,8,120` para esos productos + `movimientos_stock` `seed inicial`.
- `services/svc-ordenes/src/seed.ts`: orden `2222...001` pendiente (2x `SKU-SEED-001`) idempotente.
- `services/*/package.json` `seed: "tsx src/seed.ts"`; `scripts/seed.sh` orquesta los 3; `Makefile` `seed` delega.

---

## Consecuencias

### Positivas

- **Hot-reload funcional:** `npm run dev` levanta stack en <30s, `tsx watch` refleja cambios sin rebuild manual; `docker-compose.dev.yml:12` documentado.
- **Calidad consistente:** `eslint --fix` + `prettier` en pre-commit evita divergencia; `format:check` en CI bloquea PR sin formato.
- **Mensajes de commit trazables:** `commitlint` fuerza `feat/fix/chore` para changelog automático desde Fase 6.
- **Fail-fast en env:** `validateEnv()` lanza al arranque con lista de vars inválidas en vez de `TypeError: Cannot read DATABASE_URL` tardío.
- **Onboarding 1 comando:** `make dev` o `make help` suficiente; `scripts/dev.sh` abstrae flags de compose.
- **Reproducibilidad:** seeds con IDs fijos permiten `curl http://localhost/api/v1/productos/1111...001` determinístico y E2E sin `Date.now()`.

### Negativas y mitigaciones

- **Dependencia extra `tsx` en prod:** solo en `dev`/`seed`; Docker `production` usa `node dist/index.js` sin `tsx`.
- **Husky puede Molestar en CI sin git:** `prepare` con `|| true` y `lint-staged` solo en `pre-commit` local.
- **Volúmenes bind en Windows:** `CHOKIDAR_USEPOLLING` aumenta CPU; documentado en `docker-compose.dev.yml:27` y `README.md:189`.
- **`packages/env` añade build step:** Docker `build-shared` ahora compila `@erp/env` además de `shared-types`/`event-bus` (+~5s), aceptable vs garantía de tipos.

---

## Alternativas rechazadas

- **Tilt/Skaffold para dev:** potente pero sobrekill para 4 servicios; `compose watch` nativo suficiente.
- **Biome en vez de ESLint+Prettier:** migración más rápida pero ecosistema `typescript-eslint` más maduro para reglas específicas de proyecto.
- **dotenv + Joi:** Joi no infiere tipos TS; Zod provee tipos + validación runtime con un solo schema.
- **Seeds via SQL dumps:** no idempotentes y difíciles de versionar; `tsx` seeds permiten `ON CONFLICT` y evolución con migraciones.

---

## Referencias

- `docker-compose.dev.yml`
- `eslint.config.js`, `.prettierrc.json`, `.editorconfig`
- `.husky/pre-commit`, `.husky/commit-msg`, `commitlint.config.js`, `package.json:24` `prepare`
- `packages/env/src/index.ts`, `.env.example`
- `Makefile`, `scripts/dev.sh`, `scripts/seed.sh`
- `services/svc-*/src/seed.ts`, `services/svc-*/package.json:8` `seed`
