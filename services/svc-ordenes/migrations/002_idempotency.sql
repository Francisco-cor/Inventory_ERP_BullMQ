-- Migration: 002_idempotency
-- Service: svc-ordenes
-- Idempotency-Key support for POST /api/v1/ordenes

BEGIN;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            TEXT PRIMARY KEY,
  scope          TEXT NOT NULL DEFAULT 'ordenes',
  request_hash   TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body  JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys (created_at DESC);

COMMIT;
