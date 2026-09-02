import pino, { type LoggerOptions } from "pino";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface CorrelationContext {
  correlationId: string;
  requestId: string;
}

export const correlationStore = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStore.getStore();
}

export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

export function getRequestId(): string | undefined {
  return correlationStore.getStore()?.requestId;
}

/**
 * Ejecuta fn dentro de un contexto de correlación.
 * Genera IDs si no se proveen.
 */
export function runWithCorrelation<T>(
  correlationId: string | undefined,
  requestId: string | undefined,
  fn: () => T
): T {
  const ctx: CorrelationContext = {
    correlationId: correlationId?.trim() ? correlationId : randomUUID(),
    requestId: requestId?.trim() ? requestId : correlationId?.trim() ? correlationId : randomUUID(),
  };
  return correlationStore.run(ctx, fn);
}

/**
 * Extrae correlationId/requestId de headers (case-insensitive).
 */
export function extractCorrelationFromHeaders(headers: Record<string, unknown>): {
  correlationId?: string;
  requestId?: string;
} {
  const ci = (headers["x-correlation-id"] ??
    headers["X-Correlation-Id"] ??
    headers["x-correlation-id".toLowerCase()]) as string | undefined;
  const ri = (headers["x-request-id"] ?? headers["X-Request-Id"]) as string | undefined;
  return { correlationId: ci, requestId: ri };
}

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
}

/**
 * Logger pino JSON estructurado con mixin de correlationId/requestId via AsyncLocalStorage.
 * En production emite JSON, en development usa pino-pretty si pretty=true.
 */
export function createLogger(opts: CreateLoggerOptions) {
  const level = opts.level ?? process.env.LOG_LEVEL ?? "info";
  const isProd = process.env.NODE_ENV === "production";
  const pretty = opts.pretty ?? !isProd;

  const loggerOptions: LoggerOptions = {
    level,
    base: { service: opts.service },
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const ctx = correlationStore.getStore();
      if (!ctx) return {};
      return { correlationId: ctx.correlationId, requestId: ctx.requestId };
    },
    messageKey: "msg",
  };

  if (pretty) {
    // pino-pretty transport para DX; en prod no usar (JSON puro)
    return pino({
      ...loggerOptions,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      },
    });
  }
  return pino(loggerOptions);
}

/**
 * Hook Fastify para inyectar correlationId/requestId en AsyncLocalStorage
 * y propagar headers de respuesta.
 * Uso: app.addHook("onRequest", correlationHook());
 *      app.addHook("onResponse", async (req, reply) => { reply.header("X-Correlation-Id", (req as any).correlationId) })
 */
export function createCorrelationHook() {
  return async (request: any, _reply: any) => {
    const headers = request.headers as Record<string, unknown>;
    const { correlationId: incomingCid, requestId: incomingRid } =
      extractCorrelationFromHeaders(headers);
    const correlationId = incomingCid ?? (headers["x-correlation-id"] as string) ?? randomUUID();
    const requestId = incomingRid ?? (headers["x-request-id"] as string) ?? correlationId;

    // Store for this request's async context
    // Fastify's request lifecycle is async, so we need to run the rest in context.
    // We store on request object for later hooks and for logger mixin via ALS.
    // The ALS context must wrap the handler; we use a trick: set store for current async execution
    // by entering with run. Since Fastify hooks are async, we use correlationStore.enterWith
    // (Node 16+ has enterWith). Fallback to run if not available.
    const ctx: CorrelationContext = { correlationId, requestId };
    if (typeof correlationStore.enterWith === "function") {
      correlationStore.enterWith(ctx);
    }
    request.correlationId = correlationId;
    request.requestId = requestId;
  };
}

/**
 * Helper para crear child logger con correlationId explícito (útil fuera de request, ej. jobs, consumers)
 */
export function childLoggerWithCorrelation(
  base: pino.Logger,
  correlationId?: string,
  requestId?: string
): pino.Logger {
  const cid = correlationId ?? getCorrelationId() ?? randomUUID();
  const rid = requestId ?? getRequestId() ?? cid;
  return base.child({ correlationId: cid, requestId: rid });
}
