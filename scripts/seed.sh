#!/usr/bin/env sh
set -e

echo "[seed] Ejecutando seeds determinísticos..."

echo "[seed] → svc-productos"
DATABASE_URL="${PRODUCTOS_DATABASE_URL:-postgres://productos_user:productos_pass@localhost:5433/productos_db}" npm run seed --workspace=@erp/svc-productos

echo "[seed] → svc-stock"
DATABASE_URL="${STOCK_DATABASE_URL:-postgres://stock_user:stock_pass@localhost:5435/stock_db}" npm run seed --workspace=@erp/svc-stock

echo "[seed] → svc-ordenes"
DATABASE_URL="${ORDENES_DATABASE_URL:-postgres://ordenes_user:ordenes_pass@localhost:5434/ordenes_db}" npm run seed --workspace=@erp/svc-ordenes

echo "[seed] Completado. Verifica:"
echo "  curl http://localhost/api/v1/productos | jq"
echo "  curl http://localhost/api/v1/stock/11111111-1111-4111-8111-111111111001 | jq"
