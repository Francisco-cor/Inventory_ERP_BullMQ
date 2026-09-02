-- Migration: 003_outbox
-- Service: svc-ordenes
-- Outbox para órdenes (incluye idempotencia previa)

BEGIN;

CREATE TABLE IF NOT EXISTS outbox (
  id              UUID PRIMARY KEY,
  nombre_evento   VARCHAR(100) NOT NULL,
  payload         JSONB NOT NULL,
  correlation_id  UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (estado IN ('pending', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox (created_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_estado ON outbox (estado);

COMMIT;
