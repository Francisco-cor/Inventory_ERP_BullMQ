BEGIN;

DROP TABLE IF EXISTS outbox_delivery_dlq;
DROP INDEX IF EXISTS idx_outbox_deliveries_claimable;
DROP TABLE IF EXISTS outbox_deliveries;

COMMIT;
