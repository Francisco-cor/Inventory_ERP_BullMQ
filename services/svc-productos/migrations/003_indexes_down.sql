BEGIN;

DROP INDEX IF EXISTS idx_outbox_pending_created;
DROP INDEX IF EXISTS idx_eventos_emitidos_emitido_en;

COMMIT;
