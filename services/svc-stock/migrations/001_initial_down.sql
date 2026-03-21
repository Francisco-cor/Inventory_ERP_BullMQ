-- Rollback: 001_initial
-- Service: svc-stock

BEGIN;

DROP TABLE IF EXISTS eventos_recibidos;
DROP TABLE IF EXISTS eventos_emitidos;

DROP INDEX IF EXISTS idx_movimientos_creado_en;
DROP INDEX IF EXISTS idx_movimientos_producto_id;
DROP TABLE IF EXISTS movimientos_stock;

DROP INDEX IF EXISTS idx_reservas_estado;
DROP INDEX IF EXISTS idx_reservas_producto_id;
DROP INDEX IF EXISTS idx_reservas_orden_id;
DROP TABLE IF EXISTS reservas;

DROP INDEX IF EXISTS idx_stock_sku;
DROP TABLE IF EXISTS stock;

COMMIT;
