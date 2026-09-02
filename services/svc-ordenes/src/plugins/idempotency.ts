import crypto from "node:crypto";
import { pool } from "../db/pool.js";

export function hashBody(body: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(body ?? {}))
    .digest("hex");
}

export async function getIdempotent(
  key: string,
  requestHash: string
): Promise<{ status: number; body: unknown } | { conflict: true } | null> {
  const { rows } = await pool.query(
    "SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE key = $1",
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
  body: unknown
): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency_keys (key, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO NOTHING`,
    [key, requestHash, status, JSON.stringify(body)]
  );
}
