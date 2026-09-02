BEGIN;

DROP INDEX IF EXISTS idx_outbox_pending_created;
DROP INDEX IF EXISTS idx_ordenes_estado_creada;
DROP INDEX IF EXISTS idx_idempotency_expires;

COMMIT;
