# Runbook Operacional — Inventory ERP BullMQ

Procedimientos para operar el stack en producción o entornos de staging.
Todos los comandos asumen que el stack está levantado con Docker Compose.

---

## Índice

1. [Levantar y bajar el stack](#1-levantar-y-bajar-el-stack)
2. [Dead Letter Queue (DLQ)](#2-dead-letter-queue-dlq)
3. [Rollback de migración de base de datos](#3-rollback-de-migración-de-base-de-datos)
4. [SLA Checker](#4-sla-checker)
5. [Health checks](#5-health-checks)
6. [Retención y purga de datos](#6-retención-y-purga-de-datos)
7. [Backup y Restore (PITR)](#7-backup-y-restore-pitr)
8. [Seeds y fixtures](#8-seeds-y-fixtures)

---

## 1. Levantar y bajar el stack

### Modo desarrollo (hot-reload) — recomendado

```bash
# Opción A: Makefile
make dev              # hot-reload con tsx watch
make dev-watch        # con compose --watch (v2.22+)
make logs             # seguir logs

# Opción B: npm
npm run dev           # alias a docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Opción C: script
./scripts/dev.sh              # hot-reload
./scripts/dev.sh --watch      # con file-sync
```

El override `docker-compose.dev.yml` monta `services/*/src`, `packages/*` y usa `target: deps` + `tsx watch` con `CHOKIDAR_USEPOLLING=true` para HMR en Docker (Windows/Mac). El dashboard corre en Vite HMR (`http://localhost:3000`) en vez de Nginx build.

### Modo productivo (build + start)

```bash
docker compose up -d --build
# o
make up
```

### Ver logs de un servicio

```bash
docker compose logs -f svc-ordenes
docker compose logs -f svc-stock
# o
make logs-obs
```

### Bajar conservando datos

```bash
docker compose down
# o
make down
```

### Bajar y **destruir todos los volúmenes** (reset completo de BD y Redis)

```bash
docker compose down -v
# o
make down-v
```

> **Atención**: esto borra todos los datos persistidos. Usar solo en desarrollo o para reiniciar desde cero.

### Reiniciar un servicio individual sin bajar todo el stack

```bash
docker compose restart svc-stock
```

### Seeds determinísticos (Fase 1)

```bash
make seed
# o manual
./scripts/seed.sh
# o por servicio
DATABASE_URL=postgres://productos_user:productos_pass@localhost:5433/productos_db npm run seed --workspace=@erp/svc-productos
DATABASE_URL=postgres://stock_user:stock_pass@localhost:5435/stock_db npm run seed --workspace=@erp/svc-stock
```

Seeds idempotentes con IDs fijos (`11111111-...001` / `SKU-SEED-001`..`005`). Ver `services/svc-*/src/seed.ts`.

### Tooling (Fase 1)

```bash
make type-check   # tsc en todos los workspaces
make lint         # eslint flat config (raíz)
make lint-fix     # eslint --fix
make format       # prettier --write
make format-check # prettier --check (CI)
npm run lint      # alias root
npm run format:check
```

---

## 2. Dead Letter Queue (DLQ)

Los jobs que agotan sus reintentos (3 intentos con backoff exponencial) quedan en la DLQ de cada servicio. Los endpoints requieren el header `X-Api-Key: <ADMIN_API_KEY>`.

### Ver jobs fallidos

```bash
# svc-ordenes (reemplazar el puerto/ruta según tu nginx o acceso directo)
curl -H "X-Api-Key: $ADMIN_API_KEY" http://localhost/api/v1/ordenes/admin/dlq

# Con límite
curl -H "X-Api-Key: $ADMIN_API_KEY" "http://localhost/api/v1/ordenes/admin/dlq?limit=20"
```

### Ver estadísticas agrupadas por tipo de error

```bash
curl -H "X-Api-Key: $ADMIN_API_KEY" http://localhost/api/v1/ordenes/admin/dlq/stats
```

Respuesta de ejemplo:

```json
{
  "data": {
    "total": 12,
    "transient": 9,
    "permanent": 3,
    "byErrorType": [
      { "errorType": "Error", "count": 9, "classification": "transient" },
      { "errorType": "ValidationError", "count": 3, "classification": "permanent" }
    ]
  }
}
```

- **transient**: errores de conexión/timeout → candidatos a reintento manual.
- **permanent**: errores de validación o lógica → requieren corrección antes de reintentar.

### Reintentar un job específico

```bash
JOB_ID="<id del job>"
curl -X POST \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  http://localhost/api/v1/ordenes/admin/dlq/$JOB_ID/retry
```

### Reintentar todos los jobs transient de un servicio

```bash
SERVICE="ordenes"  # productos | ordenes | stock | obs
ADMIN_API_KEY="tu-clave"

# 1. Obtener IDs de jobs transient
JOBS=$(curl -s -H "X-Api-Key: $ADMIN_API_KEY" \
  "http://localhost/api/v1/${SERVICE}/admin/dlq?limit=500" | \
  jq -r '.data[] | select(.failedReason | test("connect|timeout|ECONN"; "i")) | .id')

# 2. Reintentar cada uno
for JOB_ID in $JOBS; do
  echo "Retrying $JOB_ID..."
  curl -s -X POST \
    -H "X-Api-Key: $ADMIN_API_KEY" \
    "http://localhost/api/v1/${SERVICE}/admin/dlq/$JOB_ID/retry"
done
```

---

## 3. Rollback de migración de base de datos

Cada servicio tiene una función `rollbackLastMigration` en `src/db/migrate.ts` y archivos `*_down.sql` en `migrations/`.

### Rollback manual vía psql (método más directo)

1. Identificar la última migración aplicada:

```sql
SELECT version, aplicada_en FROM schema_migrations ORDER BY aplicada_en DESC LIMIT 5;
```

2. Ejecutar el SQL de rollback correspondiente, por ejemplo para svc-stock migración 003:

```bash
docker compose exec -T db-stock psql -U stock_user -d stock_db \
  < services/svc-stock/migrations/003_alertas_unique_down.sql
```

3. Eliminar el registro de la migración:

```sql
DELETE FROM schema_migrations WHERE version = '003_alertas_unique';
```

### Orden de rollback para svc-stock (de más reciente a más antigua)

```
003_alertas_unique  →  003_alertas_unique_down.sql
002_alertas         →  002_alertas_down.sql
001_initial         →  001_initial_down.sql
```

> **Nota**: el rollback de `001_initial` es destructivo — elimina todas las tablas del servicio.

### Flujo completo: bajar stack → corregir migración → volver a levantar

```bash
# 1. Bajar sin borrar volúmenes
docker compose down

# 2. Corregir el SQL de migración en services/<svc>/migrations/

# 3. Volver a levantar (los servicios ejecutan runMigrations al arrancar)
docker compose up -d --build
```

---

## 4. SLA Checker

El SLA checker corre en `svc-obs` como BullMQ repeatable job.

- **Intervalo**: `SLA_CHECK_INTERVAL_MS` (default: 30 000 ms).
- **Umbral**: `SLA_THRESHOLD_SECONDS` (default: 60 s). Órdenes pendientes más de este tiempo reciben `sla_warning`.
- **Lock Redis**: solo una instancia de `svc-obs` ejecuta el check por intervalo (clave `svc-obs:sla-checker:lock`).

### Ver órdenes con SLA warning activo

```bash
docker compose exec -T db-obs psql -U obs_user -d obs_db \
  -c "SELECT orden_id, creada_en, estado_sla FROM ordenes_sla WHERE estado_sla = 'sla_warning' ORDER BY creada_en;"
```

### Forzar re-evaluación (limpiar lock manualmente)

```bash
docker compose exec redis redis-cli DEL "svc-obs:sla-checker:lock"
```

El próximo ciclo del worker ejecutará el check sin esperar el TTL.

---

## 5. Health checks

Todos los servicios exponen `GET /health` que verifica DB (SELECT 1) y Redis (PING). Devuelve 200 si todo está bien, 503 si algo falla.

```bash
curl http://localhost/health                    # nginx → svc-obs (por defecto)
curl http://localhost/api/v1/productos/health   # según routing nginx
```

### Verificar todos los servicios de una vez

```bash
for SVC in productos ordenes stock obs; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/v1/${SVC}/health 2>/dev/null || echo "ERR")
  echo "svc-${SVC}: $STATUS"
done
```

Salida esperada:

```
svc-productos: 200
svc-ordenes: 200
svc-stock: 200
svc-obs: 200
```

Detalle extendido (Fase 4) incluye `pool` y `outboxPending`:

```bash
curl -s http://localhost:3001/health | jq .
# {
#   "status": "ok",
#   "service": "svc-productos",
#   "db": "ok", "redis": "ok",
#   "pool": { "totalCount": 10, "idleCount": 8, "waitingCount": 0 },
#   "outboxPending": 0
# }
curl -s http://localhost:3004/health | jq .
# { "status":"ok", "service":"svc-obs", "sseClients": 12, ... }
```

---

## 6. Retención y purga de datos

Cada servicio purga automáticamente tablas efímeras cada 24h (job `src/jobs/retention.ts`, primera ejecución a los 10s del arranque, luego 24h).

| Servicio      | Tablas purgadas                                                       | Criterio                                                          |
| ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| svc-productos | `eventos_emitidos`, `outbox`                                          | `emitido_en / published_at < NOW() - RETENTION_DAYS` (default 90) |
| svc-ordenes   | `eventos_emitidos`, `outbox`, `idempotency_keys`                      | `expires_at < NOW()` para idempotency                             |
| svc-stock     | `eventos_emitidos`, `outbox`, `idempotency_keys`, `movimientos_stock` | `creado_en < RETENTION_DAYS`                                      |
| svc-obs       | `event_log`, `outbox`, `eventos_recibidos`                            | `event_log.emitido_en < 90d`, `recibido_en < 30d` + `VACUUM`      |

### Configuración

```bash
# .env / docker-compose
RETENTION_DAYS=90                # 1..365
DB_STATEMENT_TIMEOUT_MS=5000
DB_IDLE_TX_TIMEOUT_MS=30000
```

### Ejecución manual y métricas

```bash
# Forzar purga en un servicio (vía psql)
docker compose exec -T postgres-obs psql -U obs_user -d obs_db -c \
  "DELETE FROM event_log WHERE emitido_en < NOW() - INTERVAL '90 days' RETURNING *;"
# Ver lag de outbox (si >100 → alerta Fase 6)
curl -s http://localhost:3001/health | jq .outboxPending
curl -s http://localhost:3002/health | jq .outboxPending

# Forzar job en caliente (reinicia servicio, corre a los 10s)
docker compose restart svc-obs && docker compose logs -f svc-obs | grep retention
```

El retention usa `DELETE ... WHERE <ts> < NOW() - INTERVAL '1 day' * $1` sin batch en Fase 4; si `n_dead_tup` crece, Fase 6 añadirá batch de 1000.

---

## 7. Backup y Restore (PITR)

### Backup

```bash
./scripts/backup.sh [out_dir]   # default ./backups/YYYYMMDD_HHMMSS
# o
make backup
```

El script hace `pg_dump -Fc` por cada servicio (`productos`, `ordenes`, `stock`, `obs`) con fallback `docker compose exec`. Para PITR completo, habilita WAL archiving:

```conf
# postgresql.conf (Fase 11 con CNPG/Helm, documentado aquí)
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /var/lib/postgresql/wal/%f && cp %p /var/lib/postgresql/wal/%f'
```

Verifica backups:

```bash
ls -lh ./backups/20250902_120000/
pg_restore --list ./backups/.../productos.dump | head -20
```

### Restore

```bash
./scripts/restore.sh ./backups/20250902_120000
# borra y restaura con pg_restore --clean --if-exists (CUIDADO: destructivo)
```

**RPO/RTO:**

- Con `pg_dump` diario: RPO 24h, RTO <10m (4 DBs en paralelo).
- Con WAL archiving (Fase 11): RPO 5m, RTO <15m (restore + replay).

Ver `docs/adr/007-retencion-datos.md` y `scripts/restore.sh`.

---

## 8. Seeds y fixtures

### Seed determinístico (5 productos)

```bash
make seed
# idempotente ON CONFLICT (id) DO UPDATE, IDs fijos 11111111-...001..005
```

### Seed grande (100 productos sintéticos, para load tests)

```bash
npm run seed:large --workspace=@erp/svc-productos
# o
DATABASE_URL=postgres://productos_user:productos_pass@localhost:5433/productos_db npm run seed:large --workspace=@erp/svc-productos
# genera SKU-LARGE-100..199 determinístico (seed 42), precio aleatorio 10..510
```

Fuente: `services/svc-productos/src/seed/fixtures.ts` (`generateProductos`, `generateOrdenes`) y `src/seed/large.ts`.

Para k6 (Fase 7): `tests/load/order-flow.js` usa `SKU-LARGE-*` y valida confirmación vía SSE.
