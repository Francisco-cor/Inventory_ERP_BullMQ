BEGIN;

DROP INDEX IF EXISTS idx_outbox_pending_created;
DROP INDEX IF EXISTS idx_event_log_emitido_correlation;

COMMIT;
