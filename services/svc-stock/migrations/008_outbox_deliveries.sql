-- Migration: 008_outbox_deliveries
-- Service: svc-stock

BEGIN;

CREATE TABLE IF NOT EXISTS outbox_deliveries (
  outbox_id       UUID NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  destination     VARCHAR(100) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (estado IN ('pending', 'published', 'dlq')),
  lease_token     UUID,
  lease_until     TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  PRIMARY KEY (outbox_id, destination)
);

CREATE INDEX IF NOT EXISTS idx_outbox_deliveries_claimable
  ON outbox_deliveries (lease_until, created_at)
  WHERE published_at IS NULL AND estado = 'pending';

CREATE TABLE IF NOT EXISTS outbox_delivery_dlq (
  id              BIGSERIAL PRIMARY KEY,
  outbox_id       UUID NOT NULL,
  destination     VARCHAR(100) NOT NULL,
  nombre_evento   VARCHAR(100) NOT NULL,
  payload         JSONB NOT NULL,
  correlation_id  UUID NOT NULL,
  attempts        INTEGER NOT NULL,
  last_error      TEXT NOT NULL,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outbox_id, destination)
);

COMMIT;
