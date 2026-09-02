-- Migration: 004_indexes
-- Service: svc-ordenes

BEGIN;

CREATE INDEX IF NOT EXISTS idx_outbox_pending_created ON outbox (created_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ordenes_estado_creada ON ordenes (estado, creada_en DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);

COMMIT;
