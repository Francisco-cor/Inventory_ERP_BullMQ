-- Migration: 001_initial
-- Service: svc-productos
-- Description: Schema inicial para el servicio de productos

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla principal de productos
CREATE TABLE IF NOT EXISTS productos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku           VARCHAR(100) NOT NULL UNIQUE,
  nombre        VARCHAR(255) NOT NULL,
  descripcion   TEXT,
  precio        NUMERIC(12, 2) NOT NULL CHECK (precio >= 0),
  unidad        VARCHAR(50) NOT NULL DEFAULT 'unidad',
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_productos_sku ON productos (sku);
CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos (activo);

-- Event store local del servicio
CREATE TABLE IF NOT EXISTS eventos_emitidos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre_evento   VARCHAR(100) NOT NULL,
  payload         JSONB NOT NULL,
  correlation_id  UUID NOT NULL,
  emitido_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  job_id          VARCHAR(255),
  estado          VARCHAR(20) NOT NULL DEFAULT 'emitido'
    CHECK (estado IN ('emitido', 'procesado', 'fallido'))
);

CREATE INDEX IF NOT EXISTS idx_eventos_emitidos_nombre ON eventos_emitidos (nombre_evento);
CREATE INDEX IF NOT EXISTS idx_eventos_emitidos_correlation ON eventos_emitidos (correlation_id);
CREATE INDEX IF NOT EXISTS idx_eventos_emitidos_estado ON eventos_emitidos (estado);

-- Función para actualizar automaticamente updated_at
CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_productos_actualizado_en
  BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

COMMIT;
