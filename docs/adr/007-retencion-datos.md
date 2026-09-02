# ADR #007 — Retención de datos y estrategia de migraciones

**Estado:** Aceptado
**Fecha:** 2026-09-02
**Autores:** Equipo ERP
**Fase:** 4 — Persistencia y Gestión de Datos

---

## Contexto

Tras Fase 3, cada servicio acumula datos sin TTL:

- `event_log` (`svc-obs`) crece infinito (`migrations/001_initial.sql:10` sin retención).
- `eventos_emitidos` y `outbox` (4 servicios) nunca se purgan → tabla multi-GB tras meses.
- `idempotency_keys` y `movimientos_stock` sin limpieza → bloat y vacuum costoso.
- `schema_migrations` custom sin `pg_advisory_lock` → dos réplicas iniciando a la vez pueden aplicar la misma migración duplicada.
- `migrate.ts` duplicado en 4 servicios, sin `checksum` → editar un `.sql` ya aplicado no se detecta.
- `pool.ts` inconsistente: `svc-obs` sin `idleTimeout`, sin `statement_timeout`, sin `pool.on('error')`.

Se evaluó cómo profesionalizar el ciclo de vida de datos sin introducir operadores externos (pg_cron, Debezium) en Fase 4.

---

## Decisión

### a) Migrador unificado con lock y checksums

- Nuevo paquete `packages/db-migrate` (`src/index.ts` `createMigrator`):
  - `CREATE TABLE schema_migrations (version PK, aplicada_en, checksum VARCHAR(64))` + backfill `ADD COLUMN checksum IF NOT EXISTS`.
  - `SELECT pg_advisory_lock($1)` / `pg_advisory_unlock` (lockKey por servicio: 1001 productos, 1002 órdenes, 1003 stock, 1004 obs) evita carreras en `docker compose up --scale svc-obs=2`.
  - `sha256(sql)` por migración; en `runMigrations` compara `checksum` almacenado vs calculado; si difiere → `throw Checksum mismatch` (obliga a nueva migración, nunca editar una aplicada). Si `checksum` es `null` (DB vieja) hace `UPDATE` backfill.
  - `rollbackLastMigration` y `validateChecksums` expuestos para CI / runbook.
- Cada `services/*/src/db/migrate.ts` ahora es 15 líneas: `createMigrator({ migrations, migrationsDir, lockKey })` + re-export. `001_initial.sql` no se toca; nuevas migraciones `003_indexes`, `004_indexes`, `006_indexes` añaden índices.
- `Dockerfile` y `docker-compose.dev.yml` copian `packages/db-migrate` y hacen `npm run build --workspace=@erp/db-migrate`.

### b) Índices y timeouts

- Migraciones `*_indexes.sql` (`svc-productos/003`, `svc-ordenes/004`, `svc-stock/006`, `svc-obs/003`):
  - `idx_outbox_pending_created ON outbox(created_at) WHERE published_at IS NULL` — acelera relay poll.
  - `idx_event_log_emitido_correlation ON event_log(correlation_id, emitido_en)` — trace por orden.
  - `idx_ordenes_estado_creada ON ordenes(estado, creada_en)` — SLA checker.
  - `idx_stock_actualizado`, `idx_movimientos_creado`, `idx_idempotency_expires` — queries críticas <50ms p95.
- `pool.ts` unificado (4 servicios):
  - `statement_timeout = DB_STATEMENT_TIMEOUT_MS` (5000ms), `idle_in_transaction_session_timeout = DB_IDLE_TX_TIMEOUT_MS` (30000ms), `query_timeout = DB_QUERY_TIMEOUT_MS` (5000ms) en `Pool` + `SET` en `pool.on('connect')`.
  - `pool.on('error')` loggea `"Unexpected error on idle client"`.
  - `getPoolMetrics() → { totalCount, idleCount, waitingCount }`.
  - Env vars `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`, `DB_POOL_MAX`, `RETENTION_DAYS` validadas en `packages/env` con defaults.

### c) Retention jobs (app-level, no pg_cron)

- `services/*/src/jobs/retention.ts` (4 variantes por dominio):
  - `productos`: purga `eventos_emitidos` + `outbox(published_at NOT NULL)` > `RETENTION_DAYS` (default 90).
  - `ordenes`: + `idempotency_keys` expiradas.
  - `stock`: + `movimientos_stock` viejos.
  - `obs`: + `event_log` > `RETENTION_DAYS` y `eventos_recibidos` > 30 días; `VACUUM (VERBOSE) event_log` si hubo borrados.
  - `runRetention()` usa `DELETE ... WHERE <ts> < NOW() - INTERVAL '1 day' * $1` con `RETENTION_DAYS` param; loggea `deleted N rows`. Sin batch 1000 en esta fase (DELETE único es suficiente <1M rows; Fase 6 medirá bloat y añadirá batch si p95 >100ms).
  - `startRetentionJob()` agenda `setTimeout(10s)` + `setInterval(24h)`; `stopRetentionJob()` en `SIGTERM`/`SIGINT`.
  - `src/index.ts` de cada servicio importa y arranca `startRetentionJob()` tras `startOutboxRelay()`.
- Tradeoff `pg_cron` vs app job: `pg_cron` requiere superuser y extensión en Postgres, acopla scheduling a DB; app job es visible en logs, testeable con `runRetention()` unit, y comparte `RETENTION_DAYS` env.

### d) Health y métricas

- `GET /health` (4 servicios) extendido:
  - `await pool.query("SELECT 1")` → `db`, `eventBus.ping()` → `redis`, `SELECT COUNT(*) FROM outbox WHERE published_at IS NULL` → `outboxPending`, `getPoolMetrics()` → `pool`, `sseClients` en `svc-obs`, `503` si degradado.
  - `pool` y `outboxPending` permiten alertar `OutboxLag > 100` o `pool.waitingCount > 5`.

### e) Backup PITR

- `scripts/backup.sh` (`pg_dump -Fc` por servicio, dual `PGPASSWORD` + `docker compose exec -T postgres-*` fallback) y `scripts/restore.sh` (`pg_restore --clean --if-exists`).
- `docs/runbook.md` sección `Backup & Restore` con RPO/RTO y archiving WAL (`archive_command`) documentado. `docker-compose.yml` no añade `pg_wal` volume en esta fase para no romper backward-compat; Fase 11 lo añade con Helm.

### f) Seeds realistas

- `services/svc-productos/src/seed/fixtures.ts` `generateProductos(100, seed=42)` determinístico (`seededRandom`) + `generateOrdenes(productoIds, 200)`, `services/svc-productos/src/seed/large.ts` inserta 100 productos sintéticos `SKU-LARGE-100..199` con `ON CONFLICT (id) DO UPDATE` (idempotente, para k6).
- `package.json` `seed:large` (`tsx src/seed/large.ts`) y `npm run seed:large --workspace=@erp/svc-productos`.
- Fase 9 completará `seed:large` multi-almacén.

---

## Consecuencias

**Positivas:**

- Migraciones seguras en despliegues concurrentes; checksum detecta edits accidentales en CI.
- Queries críticas con índices adecuados; `EXPLAIN ANALYZE` <50ms p95.
- Crecimiento acotado de `event_log`/`outbox` (90 días configurable) sin operador externo.
- Health expone `outboxPending` y `pool` para Prometheus (Fase 6) sin métricas aún.

**Negativas:**

- Retention `DELETE` sin batch puede bloquear tabla si >500k rows; mitigado por `statement_timeout` 5s y ejecución diaria 02:00 UTC (baja carga); se medirá en Fase 6.
- `VACUUM` solo en `svc-obs`; otros servicios dependen de autovacuum; se monitorizará `pg_stat_user_tables.n_dead_tup`.

---

## Alternativas rechazadas

- **pg_cron / pg_partman:** requiere `shared_preload_libraries`, no disponible en `postgres:16-alpine` sin build custom; se re-evalúa en Fase 11 (K8s + CNPG).
- **Archivado a S3 + purga:** overkill antes de tener 10M rows; Fase 11 añadirá `barman` si RPO <1h.
- **Outbox relay con `LISTEN/NOTIFY`:** reduce poll 500ms pero añade canal PG; se deja como optimización futura (ADR 006 ya menciona `LISTEN/NOTIFY` opcional).

---

## Referencias

- `packages/db-migrate/src/index.ts`, `packages/env/src/index.ts:34`
- `services/*/src/db/pool.ts`, `src/db/migrate.ts`, `src/jobs/retention.ts`, `src/routes/health.ts`, `src/index.ts`
- `services/*/migrations/*_indexes.sql` y `*_down.sql`
- `scripts/backup.sh`, `scripts/restore.sh`
- `services/svc-productos/src/seed/fixtures.ts`, `src/seed/large.ts`
- `docs/runbook.md#backup--restore`, `.env.example:65`
