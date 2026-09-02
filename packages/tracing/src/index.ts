import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

let sdk: NodeSDK | null = null;

/**
 * Inicializa OpenTelemetry.
 * - Si OTEL_EXPORTER_OTLP_ENDPOINT no está seteado y NODE_ENV != production, se hace no-op (log info).
 * - Instrumenta pg, redis (ioredis), fastify, http, etc vía auto-instrumentations.
 * - Propaga traceparent/baggage (W3C) automáticamente; correlationId se añade como baggage en bus/even log si se desea.
 * Llamar lo antes posible (antes de importar Fastify/BullMQ).
 */
export async function initTracing(serviceName: string): Promise<void> {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const enabled = (process.env.OTEL_ENABLED ?? (endpoint ? "true" : "false")) === "true";

  if (!enabled) {
    if (process.env.LOG_LEVEL === "debug") {
      console.log(
        `[otel] tracing disabled for ${serviceName} (set OTEL_EXPORTER_OTLP_ENDPOINT to enable)`
      );
    }
    return;
  }

  // Diagnostics para debug
  if (process.env.OTEL_DIAG === "1") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const exporter = new OTLPTraceExporter({
    url: endpoint ?? "http://otel-collector:4318/v1/traces",
  });

  sdk = new NodeSDK({
    resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: serviceName }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Desactivar instrumentaciones ruidosas si hace falta
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  });

  try {
    await sdk.start();
    console.log(
      `[otel] tracing started for ${serviceName} -> ${endpoint ?? "http://otel-collector:4318/v1/traces"}`
    );
  } catch (e) {
    console.error(`[otel] failed to start for ${serviceName}`, e);
  }
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log("[otel] tracing shutdown");
    } catch (e) {
      console.error("[otel] shutdown error", e);
    }
    sdk = null;
  }
}

// Re-export API para uso manual (span, baggage)
export { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api";
