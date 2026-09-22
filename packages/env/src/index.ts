import { z } from "zod";
import { readFileSync } from "node:fs";

/**
 * Validación centralizada de variables de entorno con Zod.
 * Cada servicio importa y valida al arranque (fail-fast).
 * Ver .env.example para documentación.
 */

const BaseEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine(
        (v) => v.startsWith("postgres://") || v.startsWith("postgresql://"),
        "DATABASE_URL must start with postgres://"
      ),
    REDIS_HOST: z.string().min(1).default("redis"),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    ADMIN_API_KEY: z.string().optional(),
    CORS_ORIGIN: z.string().optional(),
    JWT_SECRET: z.string().min(16, "JWT_SECRET debe tener al menos 16 caracteres").optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    // Servicio stock
    STOCK_ALERTA_UMBRAL: z.coerce.number().int().min(1).max(1000).default(10),

    // Event bus
    EVENT_BUS_SERVICES: z.string().optional(),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10000).default(500),
    OUTBOX_LEASE_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(1000).default(20),

    // Dependencia temporal de catálogo para validar snapshots de órdenes
    PRODUCTOS_SERVICE_URL: z.string().url().default("http://localhost:3001"),
    CATALOG_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(1500),

    // DB
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
    DB_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    DB_QUERY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
    RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),

    // Servicio obs
    SLA_THRESHOLD_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
    SLA_CHECK_INTERVAL_MS: z.coerce.number().int().min(1000).max(600000).default(30000),
    SLA_LOCK_TTL_MS: z.coerce.number().int().min(10000).max(3600000).default(120000),
    SSE_ADAPTER: z.enum(["memory", "redis"]).default("memory"),
    SSE_MAX_CLIENTS: z.coerce.number().int().min(1).max(10000).default(100),
    HEALTH_AGGREGATE_TIMEOUT_MS: z.coerce.number().int().min(500).max(10000).default(2000),

    // Observabilidad (OTEL)
    OTEL_ENABLED: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().optional(),
    OTEL_DIAG: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "production" && !data.ADMIN_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMIN_API_KEY"],
        message: "ADMIN_API_KEY es requerido en production (fail-closed)",
      });
    }
  });

export type Env = z.infer<typeof BaseEnvSchema>;

const FILE_BACKED_SECRETS = ["DATABASE_URL", "ADMIN_API_KEY", "JWT_SECRET"] as const;

export function resolveFileSecrets(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved = { ...raw };
  for (const name of FILE_BACKED_SECRETS) {
    if (resolved[name]?.trim()) continue;
    const file = resolved[`${name}_FILE`];
    if (!file) continue;
    try {
      const value = readFileSync(file, "utf8").trim();
      if (value) resolved[name] = value;
    } catch (err) {
      throw new Error(
        `[env] No se pudo leer ${name}_FILE (${file}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return resolved;
}

export function validateEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const resolved = resolveFileSecrets(raw);
  if (raw === process.env) {
    for (const name of FILE_BACKED_SECRETS) {
      if (resolved[name]) process.env[name] = resolved[name];
    }
  }
  const parsed = BaseEnvSchema.safeParse(resolved);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[env] Invalid environment variables:\n${formatted}\n\nCheck .env.example`);
  }
  return parsed.data;
}

// Helper para validar sin lanzar, útil en tests
export function isEnvValid(raw: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return BaseEnvSchema.safeParse(resolveFileSecrets(raw)).success;
  } catch {
    return false;
  }
}

export const envSchema = BaseEnvSchema;
