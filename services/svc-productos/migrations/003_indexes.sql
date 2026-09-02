-- Migration: 003_indexes
-- Service: svc-productos
-- Indexes for outbox and retention

BEGIN;

CREATE INDEX IF NOT EXISTS idx_outbox_pending_created ON outbox (created_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_eventos_emitidos_emitido_en ON eventos_emitidos (emitido_en DESC);

COMMIT;
