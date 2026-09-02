-- Migration: 003_indexes
-- Service: svc-obs

BEGIN;

CREATE INDEX IF NOT EXISTS idx_outbox_pending_created ON outbox (created_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_log_emitido_correlation ON event_log (correlation_id, emitido_en DESC);

COMMIT;
