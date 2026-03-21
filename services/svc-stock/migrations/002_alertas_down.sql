-- Rollback: 002_alertas
-- Service: svc-stock

BEGIN;

DROP INDEX IF EXISTS idx_alertas_creada_en;
DROP INDEX IF EXISTS idx_alertas_resuelta;
DROP INDEX IF EXISTS idx_alertas_producto_id;
DROP TABLE IF EXISTS alertas_stock;

COMMIT;
