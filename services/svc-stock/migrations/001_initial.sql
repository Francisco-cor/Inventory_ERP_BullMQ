-- Migration: 001_initial
-- Service: svc-stock
-- Description: Schema inicial para el servicio de stock

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Stock por producto (una fila por producto)
CREATE TABLE IF NOT EXISTS stock (
  producto_id     UUID PRIMARY KEY,
  sku             VARCHAR(100) NOT NULL,
  disponible      INTEGER NOT NULL DEFAULT 0 CHECK (disponible >= 0),
  reservado       INTEGER NOT NULL DEFAULT 0 CHECK (reservado >= 0),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_sku ON stock (sku);

-- Vista calculada (total = disponible + reservado)
-- Se usa una columna generada para consistencia
ALTER TABLE stock
  ADD COLUMN IF NOT EXISTS total INTEGER GENERATED ALWAYS AS (disponible + reservado) STORED;

-- Reservas activas por orden (para liberar al cancelar)
CREATE TABLE IF NOT EXISTS reservas (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orden_id     UUID NOT NULL,
  producto_id  UUID NOT NULL,
  cantidad     INTEGER NOT NULL CHECK (cantidad > 0),
  creada_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  liberada_en  TIMESTAMPTZ,
  estado       VARCHAR(20) NOT NULL DEFAULT 'activa'
    CHECK (estado IN ('activa', 'liberada', 'consumida'))
);

CREATE INDEX IF NOT EXISTS idx_reservas_orden_id ON reservas (orden_id);
CREATE INDEX IF NOT EXISTS idx_reservas_producto_id ON reservas (producto_id);
CREATE INDEX IF NOT EXISTS idx_reservas_estado ON reservas (estado);

-- Historial de movimientos de stock (event sourcing local)
CREATE TABLE IF NOT EXISTS movimientos_stock (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id   UUID NOT NULL,
  tipo          VARCHAR(30) NOT NULL
    CHECK (tipo IN ('ingreso', 'egreso', 'reserva', 'liberacion', 'ajuste')),
  delta         INTEGER NOT NULL,
  referencia_id UUID,
  motivo        TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movimientos_producto_id ON movimientos_stock (producto_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_creado_en ON movimientos_stock (creado_en DESC);

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

-- Idempotencia de eventos recibidos
CREATE TABLE IF NOT EXISTS eventos_recibidos (
  event_id       UUID PRIMARY KEY,
  nombre_evento  VARCHAR(100) NOT NULL,
  recibido_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
