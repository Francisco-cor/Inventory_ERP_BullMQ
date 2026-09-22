import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createMigrator } from "@erp/db-migrate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

const migrations = [
  { version: "001_initial", file: "001_initial.sql", downFile: "001_initial_down.sql" },
  { version: "002_idempotency", file: "002_idempotency.sql", downFile: "002_idempotency_down.sql" },
  { version: "003_outbox", file: "003_outbox.sql", downFile: "003_outbox_down.sql" },
  { version: "004_indexes", file: "004_indexes.sql", downFile: "004_indexes_down.sql" },
  {
    version: "005_outbox_leases",
    file: "005_outbox_leases.sql",
    downFile: "005_outbox_leases_down.sql",
  },
  {
    version: "006_outbox_deliveries",
    file: "006_outbox_deliveries.sql",
    downFile: "006_outbox_deliveries_down.sql",
  },
  {
    version: "007_catalog_read_model",
    file: "007_catalog_read_model.sql",
    downFile: "007_catalog_read_model_down.sql",
  },
];

const migrator = createMigrator({ migrations, migrationsDir, lockKey: 1002 });

export const runMigrations = migrator.runMigrations;
export const rollbackLastMigration = migrator.rollbackLastMigration;
export const validateChecksums = migrator.validateChecksums;
