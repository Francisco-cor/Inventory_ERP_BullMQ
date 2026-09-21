BEGIN;

DROP INDEX IF EXISTS idx_outbox_claimable;
ALTER TABLE outbox DROP COLUMN IF EXISTS lease_until;
ALTER TABLE outbox DROP COLUMN IF EXISTS lease_token;

COMMIT;
