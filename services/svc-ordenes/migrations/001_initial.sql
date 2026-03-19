-- Migration: 001_initial
-- Service: svc-ordenes
-- Description: Schema inicial para el servicio de órdenes

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE estado_orden AS ENUM ('pendiente', 'confirmada', 'cancelada');

-- Tabla principal de órdenes
CREATE TABLE IF NOT EXISTS ordenes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  estado          estado_orden NOT NULL DEFAULT 'pendiente',
  total           NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  creada_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ordenes_estado ON ordenes (estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_creada_en ON ordenes (creada_en DESC);

-- Líneas de la orden (desnormalizadas para independencia del svc-productos)
CREATE TABLE IF NOT EXISTS lineas_orden (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orden_id         UUID NOT NULL REFERENCES ordenes (id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL,
  sku              VARCHAR(100) NOT NULL,
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario  NUMERIC(12, 2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal         NUMERIC(14, 2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);

CREATE INDEX IF NOT EXISTS idx_lineas_orden_orden_id ON lineas_orden (orden_id);
CREATE INDEX IF NOT EXISTS idx_lineas_orden_producto_id ON lineas_orden (producto_id);

-- Event store local
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

CREATE INDEX IF NOT EXISTS idx_eventos_ordenes_nombre ON eventos_emitidos (nombre_evento);
CREATE INDEX IF NOT EXISTS idx_eventos_ordenes_correlation ON eventos_emitidos (correlation_id);

-- Eventos recibidos (para idempotencia)
CREATE TABLE IF NOT EXISTS eventos_recibidos (
  event_id       UUID PRIMARY KEY,
  nombre_evento  VARCHAR(100) NOT NULL,
  recibido_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizada_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ordenes_actualizada_en
  BEFORE UPDATE ON ordenes
  FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

COMMIT;
