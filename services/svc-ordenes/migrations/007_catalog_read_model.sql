-- Migration: 007_catalog_read_model
-- Service: svc-ordenes
-- Local catalog/pricing projection used when creating order snapshots.

BEGIN;

CREATE TABLE IF NOT EXISTS catalogo_productos (
  producto_id       UUID PRIMARY KEY,
  sku               VARCHAR(100) NOT NULL,
  precio            NUMERIC(12, 2) NOT NULL CHECK (precio >= 0),
  activo            BOOLEAN NOT NULL,
  version_precio    BIGINT NOT NULL DEFAULT 1 CHECK (version_precio > 0),
  source_event_id   UUID NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalogo_productos_sku ON catalogo_productos (sku);
CREATE INDEX IF NOT EXISTS idx_catalogo_productos_activo ON catalogo_productos (activo);

ALTER TABLE lineas_orden
  ADD COLUMN IF NOT EXISTS version_precio BIGINT NOT NULL DEFAULT 1;

COMMIT;
