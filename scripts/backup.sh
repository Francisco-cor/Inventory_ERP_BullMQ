#!/usr/bin/env sh
set -e

# Backup PITR — pg_dump + WAL (scripts/backup.sh)
# Uso: ./scripts/backup.sh [out_dir]
# Requiere: docker compose up, pg_dump

OUT_DIR="${1:-./backups/$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$OUT_DIR"

echo "[backup] Destino: $OUT_DIR"

for SVC in productos ordenes stock obs; do
  case "$SVC" in
    productos) DB="${PRODUCTOS_DB_NAME:-productos_db}"; USER="${PRODUCTOS_DB_USER:-productos_user}"; PASS="${PRODUCTOS_DB_PASS:-productos_pass}"; PORT="5433" ;;
    ordenes)   DB="${ORDENES_DB_NAME:-ordenes_db}";     USER="${ORDENES_DB_USER:-ordenes_user}";     PASS="${ORDENES_DB_PASS:-ordenes_pass}";     PORT="5434" ;;
    stock)     DB="${STOCK_DB_NAME:-stock_db}";         USER="${STOCK_DB_USER:-stock_user}";         PASS="${STOCK_DB_PASS:-stock_pass}";         PORT="5435" ;;
    obs)       DB="${OBS_DB_NAME:-obs_db}";             USER="${OBS_DB_USER:-obs_user}";             PASS="${OBS_DB_PASS:-obs_pass}";             PORT="5436" ;;
  esac
  echo "[backup] $SVC ($DB)..."
  if PGPASSWORD="$PASS" pg_dump -h localhost -p "$PORT" -U "$USER" -d "$DB" -Fc -f "$OUT_DIR/${SVC}.dump"; then
    continue
  fi
  if docker compose exec -T "postgres-${SVC}" pg_dump -U "$USER" -d "$DB" -Fc > "$OUT_DIR/${SVC}.dump"; then
    continue
  fi
  echo "[backup] ERROR: $SVC fallo (¿DB levantada y credenciales correctas?)" >&2
  exit 1
done

echo "[backup] Listo. Para PITR, archiva WAL con archive_command en postgresql.conf"
echo "[backup] Ver docs/runbook.md#backup"
ls -lh "$OUT_DIR"
