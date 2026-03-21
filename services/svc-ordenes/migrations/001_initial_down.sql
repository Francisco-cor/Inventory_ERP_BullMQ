-- Rollback: 001_initial
-- Service: svc-ordenes

BEGIN;

DROP TRIGGER IF EXISTS trigger_ordenes_actualizada_en ON ordenes;
DROP FUNCTION IF EXISTS actualizar_timestamp();

DROP TABLE IF EXISTS eventos_recibidos;

DROP INDEX IF EXISTS idx_eventos_ordenes_correlation;
DROP INDEX IF EXISTS idx_eventos_ordenes_nombre;
DROP TABLE IF EXISTS eventos_emitidos;

DROP INDEX IF EXISTS idx_lineas_orden_producto_id;
DROP INDEX IF EXISTS idx_lineas_orden_orden_id;
DROP TABLE IF EXISTS lineas_orden;

DROP INDEX IF EXISTS idx_ordenes_creada_en;
DROP INDEX IF EXISTS idx_ordenes_estado;
DROP TABLE IF EXISTS ordenes;

DROP TYPE IF EXISTS estado_orden;

COMMIT;
