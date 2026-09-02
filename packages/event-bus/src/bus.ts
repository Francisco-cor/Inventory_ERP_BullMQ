import { Queue, Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import type { DomainEvent, EventName, ServiceName } from "@erp/shared-types";
import { validateEventPayload } from "./schemas.js";

export interface RedisConfig {
  host: string;
  port: number;
}

export interface EventBusConfig {
  serviceName: ServiceName;
  redis: RedisConfig;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void>;

export const CURRENT_SCHEMA_VERSION = "1.0";

// ─── Metrics (in-memory, exposed via getMetrics) ─────────────────────────────
let metrics = {
  published: 0,
  failed: 0,
  consumed: 0,
  skippedVersion: 0,
  dlq: 0,
};

export function getBusMetrics() {
  return { ...metrics };
}

const TRANSIENT_KEYWORDS = [
  "econnrefused",
  "etimedout",
  "econnreset",
  "connect",
  "timeout",
  "unavailable",
  "redis",
  "network",
] as const;

function extractErrorType(reason: string): string {
  const colonIdx = reason.indexOf(":");
  if (colonIdx > 0 && colonIdx < 40) return reason.slice(0, colonIdx).trim();
  return reason.slice(0, 50).trim();
}

function classifyError(reason: string): "transient" | "permanent" {
  const lower = reason.toLowerCase();
  return TRANSIENT_KEYWORDS.some((k) => lower.includes(k)) ? "transient" : "permanent";
}

export interface FailedJob {
  id: string;
  eventName: string;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
  correlationId?: string;
}

export interface DlqErrorStat {
  errorType: string;
  count: number;
  classification: "transient" | "permanent";
}

export interface DlqStats {
  total: number;
  transient: number;
  permanent: number;
  byErrorType: DlqErrorStat[];
}

// Default service registry — overridden by EVENT_BUS_SERVICES env (comma-separated).
const ALL_SERVICES_DEFAULT: ServiceName[] = ["svc-ordenes", "svc-stock", "svc-productos", "svc-obs"];

function getAllServices(): ServiceName[] {
  const env = process.env.EVENT_BUS_SERVICES;
  if (env && env.trim().length > 0) {
    return env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as ServiceName[];
  }
  return [...ALL_SERVICES_DEFAULT];
}

// For convenience, alias used inside createEventBus
const ALL_SERVICES = ALL_SERVICES_DEFAULT;

function queueName(service: ServiceName): string {
  return `events-${service}`;
}

export function registerService(service: ServiceName): void {
  if (!ALL_SERVICES_DEFAULT.includes(service)) {
    ALL_SERVICES_DEFAULT.push(service);
  }
}

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 500 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false, // keep failed jobs visible in /admin/dlq
} as const;

export function createEventBus(config: EventBusConfig) {
  const { serviceName, redis } = config;
  const connection = { host: redis.host, port: redis.port };

  // One publish queue per service for fan-out — dynamic via EVENT_BUS_SERVICES
  const initialServices = getAllServices();
  const publishQueues = new Map<ServiceName, Queue>(
    initialServices.map((s) => [s, new Queue(queueName(s), { connection })])
  );

  // This service's own queue (used for the worker and DLQ reads)
  const myQueue = publishQueues.get(serviceName)!;

  let worker: Worker | undefined;

  // Registered handlers per event name
  const handlers = new Map<EventName, Array<EventHandler>>();

  function subscribe<T = unknown>(name: EventName, handler: EventHandler<T>): void {
    const existing = handlers.get(name) ?? [];
    handlers.set(name, [...existing, handler as EventHandler]);
  }

  function startWorker(concurrency = 5): void {
    worker = new Worker<DomainEvent>(
      queueName(serviceName),
      async (job) => {
        const event = job.data;
        // Schema version negotiation — skip unknown versions (permanent, no retry)
        if (event.schemaVersion !== CURRENT_SCHEMA_VERSION) {
          metrics.skippedVersion += 1;
          console.warn(
            JSON.stringify({
              level: "warn",
              service: serviceName,
              eventId: event.id,
              eventName: event.name,
              schemaVersion: event.schemaVersion,
              msg: "unknown schemaVersion — skipping",
            })
          );
          return;
        }
        // Validate payload for known events (permanent error if invalid)
        try {
          validateEventPayload(event.name, event.payload);
        } catch (err) {
          metrics.failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            JSON.stringify({
              level: "error",
              service: serviceName,
              eventId: event.id,
              eventName: event.name,
              error: msg,
              msg: "payload validation failed — permanent",
            })
          );
          throw err; // will be classified as permanent and go to DLQ without retry flood
        }
        metrics.consumed += 1;
        const eventHandlers = handlers.get(event.name) ?? [];
        for (const h of eventHandlers) {
          await h(event);
        }
      },
      { connection, concurrency }
    );

    worker.on("failed", (job, err) => {
      metrics.failed += 1;
      console.error(
        JSON.stringify({
          level: "error",
          service: serviceName,
          jobId: job?.id,
          eventName: job?.name,
          attempts: job?.attemptsMade,
          error: err.message,
          msg: "job failed",
        })
      );
    });

    worker.on("completed", (job) => {
      console.log(
        JSON.stringify({
          level: "info",
          service: serviceName,
          jobId: job.id,
          eventName: job.name,
          msg: "job completed",
        })
      );
    });

    console.log(
      JSON.stringify({
        level: "info",
        service: serviceName,
        queue: queueName(serviceName),
        msg: "worker started",
      })
    );
  }

  async function publish<T>(name: EventName, payload: T, correlationId?: string): Promise<string> {
    // Validate before publish (fail fast on bad payload)
    validateEventPayload(name, payload);
    const event: DomainEvent<T> = {
      id: randomUUID(),
      name,
      payload,
      timestamp: new Date().toISOString(),
      source: serviceName,
      correlationId: correlationId ?? randomUUID(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    // Fan-out: deliver to every service queue concurrently (dynamic)
    const targetServices = getAllServices();
    await Promise.all(
      targetServices.map((s) => {
        let q = publishQueues.get(s);
        if (!q) {
          q = new Queue(queueName(s), { connection });
          publishQueues.set(s, q);
        }
        return q.add(name, event, JOB_OPTIONS);
      })
    );

    metrics.published += 1;
    console.log(
      JSON.stringify({
        level: "info",
        service: serviceName,
        eventId: event.id,
        eventName: name,
        correlationId: event.correlationId,
        msg: "event published",
      })
    );

    return event.id;
  }

  // Publish a pre-constructed DomainEvent (used by outbox relay to preserve id/timestamp)
  async function publishRaw(event: DomainEvent): Promise<void> {
    validateEventPayload(event.name, event.payload);
    if (event.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error(`ValidationError: cannot publishRaw with schemaVersion ${event.schemaVersion}`);
    }
    const targetServices = getAllServices();
    await Promise.all(
      targetServices.map((s) => {
        let q = publishQueues.get(s);
        if (!q) {
          q = new Queue(queueName(s), { connection });
          publishQueues.set(s, q);
        }
        return q.add(event.name, event, JOB_OPTIONS);
      })
    );
    metrics.published += 1;
  }

  async function getFailedJobs(start = 0, end = 99): Promise<FailedJob[]> {
    const jobs = await myQueue.getFailed(start, end);
    return jobs.map((job) => ({
      id: job.id ?? "unknown",
      eventName: job.name,
      failedReason: job.failedReason ?? "unknown",
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      correlationId: (job.data as DomainEvent | undefined)?.correlationId,
    }));
  }

  async function getFailedJobStats(): Promise<DlqStats> {
    // Fetch up to 1 000 failed jobs to build stats (avoids loading unbounded data)
    const jobs = await myQueue.getFailed(0, 999);
    const counts = new Map<string, { count: number; classification: "transient" | "permanent" }>();
    for (const job of jobs) {
      const reason = job.failedReason ?? "unknown";
      const errorType = extractErrorType(reason);
      const classification = classifyError(reason);
      const existing = counts.get(errorType);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(errorType, { count: 1, classification });
      }
    }
    const byErrorType: DlqErrorStat[] = [...counts.entries()]
      .map(([errorType, { count, classification }]) => ({ errorType, count, classification }))
      .sort((a, b) => b.count - a.count);
    const transient = byErrorType
      .filter((e) => e.classification === "transient")
      .reduce((sum, e) => sum + e.count, 0);
    return { total: jobs.length, transient, permanent: jobs.length - transient, byErrorType };
  }

  async function retryJob(jobId: string): Promise<void> {
    const job = await Job.fromId(myQueue, jobId);
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queueName(serviceName)}`);
    await job.retry("failed");
  }

  async function ping(): Promise<void> {
    const client = await myQueue.client;
    await client.ping();
  }

  async function close(): Promise<void> {
    await worker?.close();
    await Promise.all([...publishQueues.values()].map((q) => q.close()));
  }

  return {
    publish,
    publishRaw,
    subscribe,
    startWorker,
    getFailedJobs,
    getFailedJobStats,
    retryJob,
    ping,
    close,
    getMetrics: getBusMetrics,
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
