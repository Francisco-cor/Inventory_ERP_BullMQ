-- Migration: 002_alertas
-- Service: svc-stock
-- Description: Tabla de alertas de stock bajo configurable por umbral

BEGIN;

CREATE TABLE IF NOT EXISTS alertas_stock (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id  UUID NOT NULL,
  sku          VARCHAR(100) NOT NULL,
  nivel_actual INTEGER NOT NULL,
  umbral       INTEGER NOT NULL,
  tipo         VARCHAR(30) NOT NULL DEFAULT 'stock_bajo'
    CHECK (tipo IN ('stock_bajo', 'stock_agotado')),
  resuelta     BOOLEAN NOT NULL DEFAULT false,
  creada_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_en  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alertas_producto_id ON alertas_stock (producto_id);
CREATE INDEX IF NOT EXISTS idx_alertas_resuelta ON alertas_stock (resuelta) WHERE resuelta = false;
CREATE INDEX IF NOT EXISTS idx_alertas_creada_en ON alertas_stock (creada_en DESC);

COMMIT;
