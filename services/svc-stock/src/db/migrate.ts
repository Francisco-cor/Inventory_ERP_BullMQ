import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(255) PRIMARY KEY,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = join(__dirname, "../../migrations");
  const migrations = [
    { version: "001_initial", file: "001_initial.sql" },
    { version: "002_alertas", file: "002_alertas.sql" },
  ];

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
