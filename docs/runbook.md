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

---

## 1. Levantar y bajar el stack

### Levantar (build + start)
```bash
docker compose up -d --build
```

### Ver logs de un servicio
```bash
docker compose logs -f svc-ordenes
docker compose logs -f svc-stock
```

### Bajar conservando datos
```bash
docker compose down
```

### Bajar y **destruir todos los volúmenes** (reset completo de BD y Redis)
```bash
docker compose down -v
```
> **Atención**: esto borra todos los datos persistidos. Usar solo en desarrollo o para reiniciar desde cero.

### Reiniciar un servicio individual sin bajar todo el stack
```bash
docker compose restart svc-stock
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
