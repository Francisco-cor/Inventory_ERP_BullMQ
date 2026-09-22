import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFileSecrets, validateEnv } from "@erp/env";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createSecretFiles() {
  const directory = mkdtempSync(join(tmpdir(), "inventory-erp-env-"));
  tempDirectories.push(directory);
  const files = {
    database: join(directory, "database-url"),
    apiKey: join(directory, "admin-api-key"),
    jwt: join(directory, "jwt-secret"),
    redis: join(directory, "redis-password"),
  };
  writeFileSync(files.database, "postgresql://user:password@db:5432/orders\n");
  writeFileSync(files.apiKey, "admin-key-from-file\n");
  writeFileSync(files.jwt, "jwt-secret-from-file-123456\n");
  writeFileSync(files.redis, "redis-secret-from-file\n");
  return files;
}

describe("file-backed environment secrets", () => {
  it("resolves database, auth and Redis secrets from *_FILE variables", () => {
    const files = createSecretFiles();
    const resolved = resolveFileSecrets({
      DATABASE_URL_FILE: files.database,
      ADMIN_API_KEY_FILE: files.apiKey,
      JWT_SECRET_FILE: files.jwt,
      REDIS_PASSWORD_FILE: files.redis,
    });

    expect(resolved.DATABASE_URL).toBe("postgresql://user:password@db:5432/orders");
    expect(resolved.ADMIN_API_KEY).toBe("admin-key-from-file");
    expect(resolved.JWT_SECRET).toBe("jwt-secret-from-file-123456");
    expect(resolved.REDIS_PASSWORD).toBe("redis-secret-from-file");
    expect(validateEnv({ ...resolved, NODE_ENV: "production" }).REDIS_PASSWORD).toBe(
      "redis-secret-from-file"
    );
  });

  it("fails clearly when a configured secret file cannot be read", () => {
    expect(() => resolveFileSecrets({ REDIS_PASSWORD_FILE: "/missing/redis-password" })).toThrow(
      /No se pudo leer REDIS_PASSWORD_FILE/
    );
  });
});
