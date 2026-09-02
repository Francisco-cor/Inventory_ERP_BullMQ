import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";

export interface MigrationDef {
  version: string;
  file: string;
  downFile?: string;
  checksum?: string;
}

export interface MigratorOptions {
  migrations: MigrationDef[];
  migrationsDir: string;
  /** Advisory lock key (int). Use distinct per service. Default 0x4d495247 (MIGR). */
  lockKey?: number;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Shared migrator with advisory lock + checksum validation.
 * Usage per service:
 *   const migrator = createMigrator({ migrations, migrationsDir, lockKey: 0x50524f44 });
 *   await migrator.runMigrations(client);
 */
export function createMigrator(opts: MigratorOptions) {
  const { migrations, migrationsDir, lockKey = 0x4d495247 } = opts;

  async function ensureMigrationsTable(client: Client): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     VARCHAR(255) PRIMARY KEY,
        aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum    VARCHAR(64)
      )
    `);
    // Add checksum column if missing (for existing DBs)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='schema_migrations' AND column_name='checksum'
        ) THEN
          ALTER TABLE schema_migrations ADD COLUMN checksum VARCHAR(64);
        END IF;
      END
      $$;
    `);
  }

  async function runMigrations(client: Client): Promise<void> {
    await ensureMigrationsTable(client);

    // Advisory lock to prevent concurrent migrations (e.g., two replicas starting)
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
    try {
      for (const migration of migrations) {
        const filePath = join(migrationsDir, migration.file);
        const sql = readFileSync(filePath, "utf-8");
        const checksum = sha256(sql);

        const { rows } = await client.query(
          "SELECT version, checksum FROM schema_migrations WHERE version = $1",
          [migration.version]
        );

        if (rows.length > 0) {
          const existing = rows[0].checksum as string | null;
          if (existing && existing !== checksum) {
            throw new Error(
              `[migrate] Checksum mismatch for ${migration.version}: expected ${existing}, got ${checksum}. ` +
                `File was modified after being applied — create a new migration instead.`
            );
          }
          if (!existing) {
            // Backfill checksum for old rows
            await client.query("UPDATE schema_migrations SET checksum = $2 WHERE version = $1", [
              migration.version,
              checksum,
            ]);
          }
          console.log(
            `[migrate] Skipping ${migration.version} (already applied, checksum ${checksum.slice(0, 8)})`
          );
          continue;
        }

        console.log(
          `[migrate] Applying ${migration.version} (checksum ${checksum.slice(0, 8)})...`
        );
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [
          migration.version,
          checksum,
        ]);
        console.log(`[migrate] Applied ${migration.version}`);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    }
  }

  async function rollbackLastMigration(client: Client, steps = 1): Promise<void> {
    await ensureMigrationsTable(client);
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
    try {
      const { rows } = await client.query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY aplicada_en DESC LIMIT $1",
        [steps]
      );
      for (const { version } of rows) {
        const migration = migrations.find((m) => m.version === version);
        if (!migration?.downFile) throw new Error(`No down file for ${version}`);
        console.log(`[migrate] Rolling back ${version}...`);
        const sql = readFileSync(join(migrationsDir, migration.downFile), "utf-8");
        await client.query(sql);
        await client.query("DELETE FROM schema_migrations WHERE version = $1", [version]);
        console.log(`[migrate] Rolled back ${version}`);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    }
  }

  async function validateChecksums(client: Client): Promise<void> {
    await ensureMigrationsTable(client);
    for (const migration of migrations) {
      const sql = readFileSync(join(migrationsDir, migration.file), "utf-8");
      const checksum = sha256(sql);
      const { rows } = await client.query(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [migration.version]
      );
      if (rows.length > 0 && rows[0].checksum && rows[0].checksum !== checksum) {
        throw new Error(`Checksum mismatch for ${migration.version}`);
      }
    }
    console.log("[migrate] All checksums valid");
  }

  return { runMigrations, rollbackLastMigration, validateChecksums };
}
