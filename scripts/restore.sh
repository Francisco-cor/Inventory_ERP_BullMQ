#!/usr/bin/env sh
set -e

# Restore PITR — pg_restore
# Uso: ./scripts/restore.sh <backup_dir>
# CUIDADO: borra y restaura DBs

if [ -z "$1" ]; then
  echo "Uso: $0 <backup_dir>"
  exit 1
fi
BACKUP_DIR="$1"

for SVC in productos ordenes stock obs; do
  case "$SVC" in
    productos) DB="${PRODUCTOS_DB_NAME:-productos_db}"; USER="${PRODUCTOS_DB_USER:-productos_user}"; PASS="${PRODUCTOS_DB_PASS:-productos_pass}"; PORT="5433" ;;
    ordenes)   DB="${ORDENES_DB_NAME:-ordenes_db}";     USER="${ORDENES_DB_USER:-ordenes_user}";     PASS="${ORDENES_DB_PASS:-ordenes_pass}";     PORT="5434" ;;
    stock)     DB="${STOCK_DB_NAME:-stock_db}";         USER="${STOCK_DB_USER:-stock_user}";         PASS="${STOCK_DB_PASS:-stock_pass}";         PORT="5435" ;;
    obs)       DB="${OBS_DB_NAME:-obs_db}";             USER="${OBS_DB_USER:-obs_user}";             PASS="${OBS_DB_PASS:-obs_pass}";             PORT="5436" ;;
  esac
  DUMP="$BACKUP_DIR/${SVC}.dump"
  if [ -f "$DUMP" ]; then
    echo "[restore] $SVC ← $DUMP"
    if PGPASSWORD="$PASS" pg_restore -h localhost -p "$PORT" -U "$USER" -d "$DB" --clean --if-exists "$DUMP"; then
      continue
    fi
    if docker compose exec -T "postgres-${SVC}" pg_restore -U "$USER" -d "$DB" --clean --if-exists < "$DUMP"; then
      continue
    fi
    echo "[restore] ERROR: $SVC fallo (¿DB levantada y credenciales correctas?)" >&2
    exit 1
  else
    echo "[restore] $DUMP no existe, skip $SVC"
  fi
done

echo "[restore] Hecho. Verifica con make ps y curl /health"
