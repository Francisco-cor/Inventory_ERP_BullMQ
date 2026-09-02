-- Migration: 006_indexes
-- Service: svc-stock

BEGIN;

CREATE INDEX IF NOT EXISTS idx_outbox_pending_created ON outbox (created_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stock_actualizado ON stock (actualizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_creado ON movimientos_stock (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);

COMMIT;
