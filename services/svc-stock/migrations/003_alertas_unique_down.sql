-- Rollback: 003_alertas_unique
-- Service: svc-stock

BEGIN;

DROP INDEX IF EXISTS idx_alertas_producto_activa;

COMMIT;
