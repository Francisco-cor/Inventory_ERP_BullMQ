#!/usr/bin/env sh
set -e

# Wrapper para levantar el stack en modo desarrollo.
# Uso: ./scripts/dev.sh  o  ./scripts/dev.sh --watch

MODE="${1:-}"

if [ "$MODE" = "--watch" ]; then
  echo "[dev] Levantando con --watch (compose v2.22+)..."
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build --watch
else
  echo "[dev] Levantando stack de desarrollo con hot-reload..."
  echo "      (usa: ./scripts/dev.sh --watch  para file-sync automático)"
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
fi
