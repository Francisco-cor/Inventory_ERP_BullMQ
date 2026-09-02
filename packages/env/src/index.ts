import { z } from "zod";

/**
 * Validación centralizada de variables de entorno con Zod.
 * Cada servicio importa y valida al arranque (fail-fast).
 * Ver .env.example para documentación.
 */

const BaseEnvSchema = z.object({
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
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ADMIN_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET debe tener al menos 16 caracteres").optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  // Servicio stock
  STOCK_ALERTA_UMBRAL: z.coerce.number().int().min(1).max(1000).default(10),

  // Event bus
  EVENT_BUS_SERVICES: z.string().optional(),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10000).default(500),

  // Servicio obs
  SLA_THRESHOLD_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  SLA_CHECK_INTERVAL_MS: z.coerce.number().int().min(1000).max(600000).default(30000),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === "production" && !data.ADMIN_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ADMIN_API_KEY"],
      message: "ADMIN_API_KEY es requerido en production (fail-closed)",
    });
  }
});

export type Env = z.infer<typeof BaseEnvSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = BaseEnvSchema.safeParse(raw);
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
  return BaseEnvSchema.safeParse(raw).success;
}

export const envSchema = BaseEnvSchema;
