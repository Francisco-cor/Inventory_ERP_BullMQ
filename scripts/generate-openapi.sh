#!/usr/bin/env sh
set -e

# Genera clientes OpenAPI desde los servicios en ejecución.
# Requiere stack levantado (make up o make dev).
# Uso: npm run openapi:generate

OUT_DIR="openapi"
mkdir -p "$OUT_DIR"

SERVICES="productos:3001 ordenes:3002 stock:3003 obs:3004"

echo "[openapi] Generando specs desde servicios locales..."

for SVC in $SERVICES; do
  NAME=$(echo "$SVC" | cut -d: -f1)
  PORT=$(echo "$SVC" | cut -d: -f2)
  URL="http://localhost:$PORT/docs/json"
  OUT="$OUT_DIR/${NAME}.json"
  echo "  → $NAME ($URL) → $OUT"
  if curl -sf "$URL" -o "$OUT"; then
    echo "    ✓ $NAME"
  else
    echo "    ✗ $NAME no disponible (¿stack levantado?)"
    rm -f "$OUT"
  fi
done

# También via nginx
for SVC in $SERVICES; do
  NAME=$(echo "$SVC" | cut -d: -f1)
  URL="http://localhost/${NAME}/docs/json"
  OUT="$OUT_DIR/${NAME}-via-nginx.json"
  curl -sf "$URL" -o "$OUT" 2>/dev/null || rm -f "$OUT"
done

echo "[openapi] Done. Archivos en $OUT_DIR/"

if command -v npx >/dev/null 2>&1; then
  echo "[openapi] Para generar cliente TypeScript:"
  echo "  npx openapi-typescript $OUT_DIR/productos.json -o openapi/productos.ts"
fi
