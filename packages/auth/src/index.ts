import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import jwt from "jsonwebtoken";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "operador" | "lector";

export interface AuthUser {
  id: string;
  role: UserRole;
  email?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    apiKeyValid?: boolean;
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────

function getEnv(name: string): string | undefined {
  return process.env[name];
}

// ─── Security plugin (helmet + cors) ─────────────────────────────────────────

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: false, // no bloquea Swagger UI
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key", "X-Correlation-Id", "Idempotency-Key"],
    exposedHeaders: ["X-Correlation-Id", "X-Request-Id"],
  });
}

// ─── API Key ─────────────────────────────────────────────────────────────────

/**
 * Enforces X-Api-Key.
 * - Si ADMIN_API_KEY no está configurada:
 *   - en development/test: bypass (modo dev)
 *   - en production: 500 (fail-closed, config error)
 * - Si está configurada: exige header exacto, 401 si falta o es inválida.
 */
export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const expected = getEnv("ADMIN_API_KEY");
  const nodeEnv = getEnv("NODE_ENV") ?? "development";

  if (!expected) {
    if (nodeEnv === "production") {
      request.log.error("[auth] ADMIN_API_KEY not configured in production — fail-closed");
      return reply.status(500).send({
        error: "ConfigurationError",
        message: "ADMIN_API_KEY no configurada en producción",
        statusCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
    return; // dev/test bypass
  }

  const provided = request.headers["x-api-key"] as string | undefined;
  if (provided !== expected) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "API key inválida o ausente. Incluya el header X-Api-Key.",
      statusCode: 401,
      timestamp: new Date().toISOString(),
    });
  }
  request.apiKeyValid = true;
}

// ─── JWT ─────────────────────────────────────────────────────────────────────

/**
 * Verifica Authorization: Bearer <token> si JWT_SECRET está configurado.
 * Si JWT_SECRET no está set, bypass en dev (para no romper flujos sin auth).
 * Si está set y el token falta o es inválido → 401.
 * Si es válido, decora request.user.
 */
export async function requireJwt(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = getEnv("JWT_SECRET");
  const nodeEnv = getEnv("NODE_ENV") ?? "development";

  if (!secret) {
    if (nodeEnv === "production") {
      request.log.warn("[auth] JWT_SECRET not set — JWT auth disabled");
    }
    return; // no JWT enforcement in dev without secret
  }

  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Token JWT requerido. Incluya Authorization: Bearer <token>",
      statusCode: 401,
      timestamp: new Date().toISOString(),
    });
  }

  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, secret) as Record<string, unknown>;
    const role = (payload.role as string) ?? "lector";
    if (!["admin", "operador", "lector"].includes(role)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: `Rol '${role}' no válido`,
        statusCode: 403,
        timestamp: new Date().toISOString(),
      });
    }
    request.user = {
      id: (payload.sub as string) ?? (payload.id as string) ?? "unknown",
      role: role as UserRole,
      email: payload.email as string | undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token inválido";
    return reply.status(401).send({
      error: "Unauthorized",
      message: `JWT inválido: ${message}`,
      statusCode: 401,
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── RBAC ────────────────────────────────────────────────────────────────────

export function requireRole(...allowed: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Si no hay user (JWT no usado), pero apiKeyValid sí, tratar como admin
    if (request.apiKeyValid && !request.user) {
      // apiKey se considera admin implícito
      return;
    }
    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Autenticación requerida",
        statusCode: 401,
        timestamp: new Date().toISOString(),
      });
    }
    if (!allowed.includes(user.role)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: `Rol '${user.role}' no autorizado. Requiere: [${allowed.join(", ")}]`,
        statusCode: 403,
        timestamp: new Date().toISOString(),
      });
    }
  };
}

// ─── Helper combinado ────────────────────────────────────────────────────────

/**
 * Auth combinada: intenta JWT si hay secret, si no valida ApiKey.
 * Útil para rutas que deben aceptar ambos mecanismos.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const jwtSecret = getEnv("JWT_SECRET");
  if (jwtSecret) {
    // Intenta JWT primero; si no hay Authorization, cae a ApiKey
    const auth = request.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      return requireJwt(request, reply);
    }
  }
  return requireApiKey(request, reply);
}
