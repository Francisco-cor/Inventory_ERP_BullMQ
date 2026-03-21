-- Rollback: 001_initial
-- Service: svc-productos

BEGIN;

DROP TRIGGER IF EXISTS trigger_productos_actualizado_en ON productos;
DROP FUNCTION IF EXISTS actualizar_timestamp();

DROP INDEX IF EXISTS idx_eventos_emitidos_estado;
DROP INDEX IF EXISTS idx_eventos_emitidos_correlation;
DROP INDEX IF EXISTS idx_eventos_emitidos_nombre;
DROP TABLE IF EXISTS eventos_emitidos;

DROP INDEX IF EXISTS idx_productos_activo;
DROP INDEX IF EXISTS idx_productos_sku;
DROP TABLE IF EXISTS productos;

COMMIT;
