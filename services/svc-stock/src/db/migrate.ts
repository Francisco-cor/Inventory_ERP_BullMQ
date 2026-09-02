import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createMigrator } from "@erp/db-migrate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

const migrations = [
  { version: "001_initial", file: "001_initial.sql", downFile: "001_initial_down.sql" },
  { version: "002_alertas", file: "002_alertas.sql", downFile: "002_alertas_down.sql" },
  {
    version: "003_alertas_unique",
    file: "003_alertas_unique.sql",
    downFile: "003_alertas_unique_down.sql",
  },
  {
    version: "004_idempotency",
    file: "004_idempotency.sql",
    downFile: "004_idempotency_down.sql",
  },
  { version: "005_outbox", file: "005_outbox.sql", downFile: "005_outbox_down.sql" },
  { version: "006_indexes", file: "006_indexes.sql", downFile: "006_indexes_down.sql" },
];

const migrator = createMigrator({ migrations, migrationsDir, lockKey: 1003 });

export const runMigrations = migrator.runMigrations;
export const rollbackLastMigration = migrator.rollbackLastMigration;
export const validateChecksums = migrator.validateChecksums;
