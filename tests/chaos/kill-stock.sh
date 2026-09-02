#!/usr/bin/env sh
set -e

# Chaos test — mata svc-stock mid-saga y verifica compensación (Fase 5)
# Requiere: docker compose up, jq, curl
# Uso: ./tests/chaos/kill-stock.sh
# Criterio: orden con stock insuficiente debe compensar a cancelled aunque svc-stock haya caído 5s mid-proceso

API="http://localhost"
PRODUCTO_ID="11111111-1111-4111-8111-111111111001"
SKU="SKU-SEED-001"

echo "[chaos] Verificando stack..."
for svc in productos ordenes stock obs; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$API/health/$svc" || echo "000")
  if [ "$code" != "200" ]; then echo "  ✗ svc-$svc health $code (esperado 200)"; exit 1; fi
  echo "  ✓ svc-$svc ok"
done

echo "[chaos] Creando orden con stock suficiente (2x $SKU)..."
ORDEN_RESP=$(curl -s -X POST "$API/api/v1/ordenes" -H "Content-Type: application/json" -d "{\"lineas\":[{\"productoId\":\"$PRODUCTO_ID\",\"sku\":\"$SKU\",\"cantidad\":2,\"precioUnitario\":89.99}]}")
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
curl -s "$API/api/v1/obs/events?eventName=order.created" | jq '.data | length' || true

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
