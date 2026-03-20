-- Migration: 003_alertas_unique
-- Service: svc-stock
-- Description: Índice único parcial para evitar alertas activas duplicadas por producto.
--              Permite múltiples alertas resueltas por producto, pero solo una activa a la vez.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alertas_producto_activa
  ON alertas_stock (producto_id)
  WHERE resuelta = false;

COMMIT;
