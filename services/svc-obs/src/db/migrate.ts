import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const migrationsDir = join(__dirname, "../../migrations");

const migrations = [
  { version: "001_initial", file: "001_initial.sql", downFile: "001_initial_down.sql" },
];

export async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(255) PRIMARY KEY,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const migration of migrations) {
    const { rows } = await client.query(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [migration.version]
    );

    if (rows.length > 0) {
      console.log(`[migrate] Skipping ${migration.version} (already applied)`);
      continue;
    }

    console.log(`[migrate] Applying ${migration.version}...`);
    const sql = readFileSync(join(migrationsDir, migration.file), "utf-8");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (version) VALUES ($1)",
      [migration.version]
    );
    console.log(`[migrate] Applied ${migration.version}`);
  }
}

/** Roll back the last `steps` applied migrations in reverse order. */
export async function rollbackLastMigration(client: pg.Client, steps = 1): Promise<void> {
  const { rows } = await client.query<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY aplicada_en DESC LIMIT $1",
    [steps]
  );

  for (const { version } of rows) {
    const migration = migrations.find((m) => m.version === version);
    if (!migration?.downFile) {
      throw new Error(`No down file registered for migration ${version}`);
    }

    console.log(`[migrate] Rolling back ${version}...`);
    const sql = readFileSync(join(migrationsDir, migration.downFile), "utf-8");
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE version = $1", [version]);
    console.log(`[migrate] Rolled back ${version}`);
  }
}
