import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

export function hashBody(body: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(sortKeys(body ?? {})))
    .digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortKeys(child)])
    );
  }
  return value;
}

/** Serializes access to one key for the lifetime of the current transaction. */
export async function lockIdempotencyKey(client: PoolClient, key: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

export async function removeExpiredIdempotencyKey(key: string, client?: PoolClient): Promise<void> {
  await (client ?? pool).query(
    "DELETE FROM idempotency_keys WHERE key = $1 AND expires_at <= NOW()",
    [key]
  );
}

export async function getIdempotent(
  key: string,
  requestHash: string,
  client?: PoolClient
): Promise<{ status: number; body: unknown } | { conflict: true } | null> {
  const { rows } = await (client ?? pool).query(
    "SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE key = $1 AND expires_at > NOW()",
    [key]
  );
  if (rows.length === 0) return null;
  if (rows[0].request_hash !== requestHash) return { conflict: true };
  return { status: rows[0].response_status, body: rows[0].response_body };
}

export async function saveIdempotent(
  key: string,
  requestHash: string,
  status: number,
  body: unknown,
  client?: PoolClient
): Promise<void> {
  await (client ?? pool).query(
    `INSERT INTO idempotency_keys (key, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO NOTHING`,
    [key, requestHash, status, JSON.stringify(body)]
  );
}
