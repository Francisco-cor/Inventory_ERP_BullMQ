-- Migration: 004_outbox_leases
-- Service: svc-obs

BEGIN;

ALTER TABLE outbox ADD COLUMN IF NOT EXISTS lease_token UUID;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_outbox_claimable
  ON outbox (lease_until, created_at)
  WHERE published_at IS NULL;

COMMIT;
