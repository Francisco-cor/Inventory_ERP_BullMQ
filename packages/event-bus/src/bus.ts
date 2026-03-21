import { Queue, Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import type { DomainEvent, EventName, ServiceName } from "@erp/shared-types";

export interface RedisConfig {
  host: string;
  port: number;
}

export interface EventBusConfig {
  serviceName: ServiceName;
  redis: RedisConfig;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void>;

export interface FailedJob {
  id: string;
  eventName: string;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
  correlationId?: string;
}

// All service queues — publish fans out to each one.
const ALL_SERVICES: ServiceName[] = ["svc-ordenes", "svc-stock", "svc-productos", "svc-obs"];

function queueName(service: ServiceName): string {
  return `events:${service}`;
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

  // One publish queue per service for fan-out
  const publishQueues = new Map<ServiceName, Queue>(
    ALL_SERVICES.map((s) => [s, new Queue(queueName(s), { connection })])
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
        const eventHandlers = handlers.get(event.name) ?? [];
        for (const h of eventHandlers) {
          await h(event);
        }
      },
      { connection, concurrency }
    );

    worker.on("failed", (job, err) => {
      console.error(
        `[event-bus:${serviceName}] Job ${job?.id} (${job?.name}) failed after ${job?.attemptsMade} attempts: ${err.message}`
      );
    });

    console.log(`[event-bus] ${serviceName} worker started → queue: ${queueName(serviceName)}`);
  }

  async function publish<T>(
    name: EventName,
    payload: T,
    correlationId?: string
  ): Promise<string> {
    const event: DomainEvent<T> = {
      id: randomUUID(),
      name,
      payload,
      timestamp: new Date().toISOString(),
      source: serviceName,
      correlationId: correlationId ?? randomUUID(),
    };

    // Fan-out: deliver to every service queue concurrently
    await Promise.all(
      ALL_SERVICES.map((s) => publishQueues.get(s)!.add(name, event, JOB_OPTIONS))
    );

    return event.id;
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

  return { publish, subscribe, startWorker, getFailedJobs, retryJob, ping, close };
}

export type EventBus = ReturnType<typeof createEventBus>;
