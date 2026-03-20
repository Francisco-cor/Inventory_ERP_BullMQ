-- Migration: 001_initial
-- Service: svc-obs
-- Description: Schema para el servicio de observabilidad

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Log de todos los eventos del sistema
CREATE TABLE IF NOT EXISTS event_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id       UUID NOT NULL UNIQUE,
  event_name     VARCHAR(100) NOT NULL,
  source         VARCHAR(50) NOT NULL,
  correlation_id UUID NOT NULL,
  payload        JSONB NOT NULL,
  emitido_en     TIMESTAMPTZ NOT NULL,
  recibido_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_log_name        ON event_log (event_name);
CREATE INDEX IF NOT EXISTS idx_event_log_emitido     ON event_log (emitido_en DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_recibido    ON event_log (recibido_en DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_correlation ON event_log (correlation_id);
CREATE INDEX IF NOT EXISTS idx_event_log_source      ON event_log (source);

-- Seguimiento de órdenes para SLA
CREATE TABLE IF NOT EXISTS ordenes_sla (
  orden_id    UUID PRIMARY KEY,
  creada_en   TIMESTAMPTZ NOT NULL,
  resuelta_en TIMESTAMPTZ,
  estado_sla  VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (estado_sla IN ('pendiente', 'confirmada', 'cancelada', 'sla_warning'))
);

CREATE INDEX IF NOT EXISTS idx_ordenes_sla_estado ON ordenes_sla (estado_sla);
CREATE INDEX IF NOT EXISTS idx_ordenes_sla_creada ON ordenes_sla (creada_en DESC);

-- Idempotencia
CREATE TABLE IF NOT EXISTS eventos_recibidos (
  event_id      UUID PRIMARY KEY,
  nombre_evento VARCHAR(100) NOT NULL,
  recibido_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
