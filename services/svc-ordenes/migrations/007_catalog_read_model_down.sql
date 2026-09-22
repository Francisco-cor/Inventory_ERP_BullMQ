BEGIN;

ALTER TABLE lineas_orden DROP COLUMN IF EXISTS version_precio;
DROP INDEX IF EXISTS idx_catalogo_productos_activo;
DROP INDEX IF EXISTS idx_catalogo_productos_sku;
DROP TABLE IF EXISTS catalogo_productos;

COMMIT;
