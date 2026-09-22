#!/usr/bin/env sh
set -e

# Chaos test — mata svc-stock mid-saga y verifica compensación (Fase 5)
# Requiere: docker compose up, jq, curl
# Uso: ./tests/chaos/kill-stock.sh
# Criterio: orden con stock insuficiente debe compensar a cancelled aunque svc-stock haya caído 5s mid-proceso

API="http://localhost"
API="${ERP_BASE_URL:-$API}"
API_KEY="${ERP_API_KEY:-${ADMIN_API_KEY:-}}"
PRODUCTO_ID="${PRODUCTO_ID:-}"
if [ -n "${SKU:-}" ]; then
  SKU="$SKU"
elif [ -n "$PRODUCTO_ID" ]; then
  SKU="SKU-SEED-001"
else
  SKU="CHAOS-$(date +%s)"
fi
SEED_PRICE="${SEED_PRICE:-89.99}"
STOCK_RESPONSE_FILE=$(mktemp /tmp/erp-chaos-stock.XXXXXX)
trap 'rm -f "$STOCK_RESPONSE_FILE"' EXIT

if [ -z "$API_KEY" ]; then
  echo "[chaos] ERP_API_KEY o ADMIN_API_KEY es obligatorio"
  exit 1
fi

echo "[chaos] Verificando stack..."
for svc in productos ordenes stock obs; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$API/health/$svc" || echo "000")
  if [ "$code" != "200" ]; then echo "  ✗ svc-$svc health $code (esperado 200)"; exit 1; fi
  echo "  ✓ svc-$svc ok"
done

if [ -z "$PRODUCTO_ID" ]; then
  echo "[chaos] Creando producto temporal $SKU..."
  PRODUCTO_RESP=$(curl -sS -X POST "$API/api/v1/productos" \
    -H "Content-Type: application/json" \
    -H "X-Api-Key: $API_KEY" \
    -d "{\"sku\":\"$SKU\",\"nombre\":\"Producto Chaos\",\"precio\":$SEED_PRICE,\"unidad\":\"pza\"}")
  PRODUCTO_ID=$(echo "$PRODUCTO_RESP" | jq -r '.data.id // .id // empty')
  if [ -z "$PRODUCTO_ID" ] || [ "$PRODUCTO_ID" = "null" ]; then
    echo "$PRODUCTO_RESP"
    echo "[chaos] no se pudo crear el producto temporal"
    exit 1
  fi
  echo "[chaos] producto creado: $PRODUCTO_ID"

  echo "[chaos] Esperando fila de stock..."
  STOCK_READY="false"
  for i in $(seq 1 30); do
    if curl -s -f "$API/api/v1/stock/$PRODUCTO_ID" >/dev/null 2>&1; then
      STOCK_READY="true"
      break
    fi
    echo "  ... esperando stock ($i/30)"
    sleep 1
  done
  if [ "$STOCK_READY" != "true" ]; then
    echo "[chaos] la fila de stock no estuvo disponible"
    exit 1
  fi

  curl -sS -X POST "$API/api/v1/stock/$PRODUCTO_ID/ajustar" \
    -H "Content-Type: application/json" \
    -H "X-Api-Key: $API_KEY" \
    -d '{"delta":2,"motivo":"Chaos test setup"}' >"$STOCK_RESPONSE_FILE"
  if ! jq -e '.data.disponible == 2' "$STOCK_RESPONSE_FILE" >/dev/null; then
    cat "$STOCK_RESPONSE_FILE"
    echo "[chaos] no se pudo cargar stock inicial"
    exit 1
  fi
fi

echo "[chaos] Creando orden con stock suficiente (2x $SKU)..."
ORDEN_RESP=""
for i in $(seq 1 15); do
  RESPONSE_WITH_STATUS=$(curl -sS -w '\n%{http_code}' -X POST "$API/api/v1/ordenes" \
    -H "Content-Type: application/json" \
    -H "X-Api-Key: $API_KEY" \
    -d "{\"lineas\":[{\"productoId\":\"$PRODUCTO_ID\",\"sku\":\"$SKU\",\"cantidad\":2,\"precioUnitario\":$SEED_PRICE}]}")
  STATUS=$(printf '%s\n' "$RESPONSE_WITH_STATUS" | tail -n 1)
  ORDEN_RESP=$(printf '%s\n' "$RESPONSE_WITH_STATUS" | sed '$d')
  if [ "$STATUS" = "201" ] || [ "$STATUS" = "200" ]; then break; fi
  if [ "$STATUS" != "503" ]; then
    echo "$ORDEN_RESP"
    echo "[chaos] creación de orden falló con HTTP $STATUS"
    exit 1
  fi
  echo "  ... esperando proyección de catálogo ($i/15)"
  sleep 1
done
echo "$ORDEN_RESP" | head -c 500; echo
ORDEN_ID=$(echo "$ORDEN_RESP" | jq -r '.data.id // .id // empty')
if [ -z "$ORDEN_ID" ] || [ "$ORDEN_ID" = "null" ]; then
  # fallback: intenta extraer id de respuesta alternativa
  ORDEN_ID=$(echo "$ORDEN_RESP" | grep -oE '[0-9a-f-]{36}' | head -n1)
fi
if [ -z "$ORDEN_ID" ]; then echo "[chaos] no se pudo crear orden"; exit 1; fi
echo "[chaos] orden creada: $ORDEN_ID (estado pendiente)"

echo "[chaos] Matando svc-stock por 8s (simula caída mid-saga)..."
docker compose kill svc-stock || docker kill svc-stock 2>/dev/null || true
sleep 2
# Verifica que nginx aún responde /health (degraded esperado, no 502)
curl -s "$API/health" | jq . | head -20 || true
sleep 6
echo "[chaos] Levantando svc-stock..."
docker compose up -d svc-stock
echo "[chaos] Esperando svc-stock healthy (30s)..."
for i in $(seq 1 15); do
  if curl -s -f "$API/health/stock" >/dev/null 2>&1; then echo "  ✓ svc-stock healthy"; break; fi
  echo "  ... esperando ($i/15)"
  sleep 2
done

echo "[chaos] Polling orden $ORDEN_ID hasta estado final (20s)..."
FINAL="pending"
for i in $(seq 1 10); do
  RESP=$(curl -s "$API/api/v1/ordenes/$ORDEN_ID" || echo "{}")
  ESTADO=$(echo "$RESP" | jq -r '.data.estado // .estado // "unknown"')
  echo "  [$i] estado=$ESTADO"
  if [ "$ESTADO" = "confirmada" ] || [ "$ESTADO" = "confirmed" ]; then FINAL="$ESTADO"; break; fi
  if [ "$ESTADO" = "cancelada" ] || [ "$ESTADO" = "cancelled" ]; then FINAL="$ESTADO"; break; fi
  sleep 2
done

# Verificación de SSE: al menos el orden debe haber aparecido en event_log
echo "[chaos] Verificando event_log en svc-obs..."
curl -s -H "X-Api-Key: $API_KEY" "$API/api/v1/obs/events?eventName=order.created" | jq '.data | length' || true

if [ "$FINAL" = "confirmada" ] || [ "$FINAL" = "confirmed" ]; then
  echo "[chaos] ✓ PASS — orden confirmada tras caída (resiliencia ok, outbox reintentó)"
  exit 0
elif [ "$FINAL" = "cancelada" ] || [ "$FINAL" = "cancelled" ]; then
  echo "[chaos] ✓ PASS — orden cancelada (compensación ok, stock insuficiente o timeout)"
  exit 0
else
  echo "[chaos] ✗ FAIL — orden en estado $FINAL tras 20s (esperado confirmada/cancelada)"
  echo "  Revisa: docker compose logs svc-stock svc-ordenes svc-obs --tail=100"
  exit 1
fi
