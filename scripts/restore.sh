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
    productos) DB="productos_db"; USER="productos_user"; PORT="5433" ;;
    ordenes)   DB="ordenes_db";   USER="ordenes_user";   PORT="5434" ;;
    stock)     DB="stock_db";     USER="stock_user";     PORT="5435" ;;
    obs)       DB="obs_db";       USER="obs_user";       PORT="5436" ;;
  esac
  DUMP="$BACKUP_DIR/${SVC}.dump"
  if [ -f "$DUMP" ]; then
    echo "[restore] $SVC ← $DUMP"
    PGPASSWORD="${USER}_pass" pg_restore -h localhost -p "$PORT" -U "$USER" -d "$DB" --clean --if-exists "$DUMP" || \
      docker compose exec -T "postgres-${SVC}" pg_restore -U "$USER" -d "$DB" --clean --if-exists < "$DUMP" || echo "  ✗ $SVC"
  else
    echo "[restore] $DUMP no existe, skip $SVC"
  fi
done

echo "[restore] Hecho. Verifica con make ps y curl /health"
