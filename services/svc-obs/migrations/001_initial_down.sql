-- Rollback: 001_initial
-- Service: svc-obs

BEGIN;

DROP TABLE IF EXISTS eventos_recibidos;

DROP INDEX IF EXISTS idx_ordenes_sla_creada;
DROP INDEX IF EXISTS idx_ordenes_sla_estado;
DROP TABLE IF EXISTS ordenes_sla;

DROP INDEX IF EXISTS idx_event_log_source;
DROP INDEX IF EXISTS idx_event_log_correlation;
DROP INDEX IF EXISTS idx_event_log_recibido;
DROP INDEX IF EXISTS idx_event_log_emitido;
DROP INDEX IF EXISTS idx_event_log_name;
DROP TABLE IF EXISTS event_log;

COMMIT;
