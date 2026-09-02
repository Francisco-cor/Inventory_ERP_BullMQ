import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createMigrator } from "@erp/db-migrate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

const migrations = [
  { version: "001_initial", file: "001_initial.sql", downFile: "001_initial_down.sql" },
  { version: "002_idempotency", file: "002_idempotency.sql", downFile: "002_idempotency_down.sql" },
  { version: "003_outbox", file: "003_outbox.sql", downFile: "003_outbox_down.sql" },
  { version: "004_indexes", file: "004_indexes.sql", downFile: "004_indexes_down.sql" },
];

const migrator = createMigrator({ migrations, migrationsDir, lockKey: 1002 });

export const runMigrations = migrator.runMigrations;
export const rollbackLastMigration = migrator.rollbackLastMigration;
export const validateChecksums = migrator.validateChecksums;
