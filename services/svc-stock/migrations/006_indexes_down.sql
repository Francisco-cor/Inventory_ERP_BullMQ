BEGIN;

DROP INDEX IF EXISTS idx_outbox_pending_created;
DROP INDEX IF EXISTS idx_stock_actualizado;
DROP INDEX IF EXISTS idx_movimientos_creado;
DROP INDEX IF EXISTS idx_idempotency_expires;

COMMIT;
