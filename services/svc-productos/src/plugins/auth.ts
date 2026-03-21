import type { FastifyReply, FastifyRequest } from "fastify";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

/**
 * Prehandler that enforces X-Api-Key authentication.
 * If ADMIN_API_KEY is not configured the check is skipped (development mode).
 */
export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!ADMIN_API_KEY) return;
  const key = request.headers["x-api-key"];
  if (key !== ADMIN_API_KEY) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "API key inválida o ausente. Incluya el header X-Api-Key.",
      statusCode: 401,
      timestamp: new Date().toISOString(),
    });
  }
}
