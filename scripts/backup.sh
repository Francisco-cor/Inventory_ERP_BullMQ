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
    productos) DB="productos_db"; USER="productos_user"; PORT="5433" ;;
    ordenes)   DB="ordenes_db";   USER="ordenes_user";   PORT="5434" ;;
    stock)     DB="stock_db";     USER="stock_user";     PORT="5435" ;;
    obs)       DB="obs_db";       USER="obs_user";       PORT="5436" ;;
  esac
  echo "[backup] $SVC ($DB)..."
  PGPASSWORD="${USER}_pass" pg_dump -h localhost -p "$PORT" -U "$USER" -d "$DB" -Fc -f "$OUT_DIR/${SVC}.dump" || \
    docker compose exec -T "postgres-${SVC}" pg_dump -U "$USER" -d "$DB" -Fc > "$OUT_DIR/${SVC}.dump" || echo "  ✗ $SVC fallo (¿DB levantada?)"
done

echo "[backup] Listo. Para PITR, archiva WAL con archive_command en postgresql.conf"
echo "[backup] Ver docs/runbook.md#backup"
ls -lh "$OUT_DIR" || true
