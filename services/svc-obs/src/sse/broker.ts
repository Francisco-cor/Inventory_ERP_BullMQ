import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

// In-memory SSE client registry (per replica)
const clients = new Map<string, ServerResponse>();

// ─── Redis adapter (optional, for horizontal scaling) ───────────────────────
const CHANNEL = "sse:broadcast";
type SseAdapter = "memory" | "redis";

interface RedisConnectionOptions {
  host: string;
  port: number;
  lazyConnect: boolean;
  maxRetriesPerRequest: number;
  password?: string;
}

interface RedisClient {
  connect(): Promise<void>;
  quit(): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<unknown>;
  on(event: "error", listener: (error: unknown) => void): RedisClient;
  on(event: "message", listener: (channel: string, message: string) => void): RedisClient;
}

interface RedisConstructor {
  new (options: RedisConnectionOptions): RedisClient;
}

let adapter: SseAdapter = (process.env.SSE_ADAPTER as SseAdapter) ?? "memory";
let pub: RedisClient | null = null;
let sub: RedisClient | null = null;
let initialized = false;

function localBroadcast(eventType: string, data: unknown): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, res] of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(id);
    }
  }
}

/**
 * Inicializa el broker SSE.
 * - memory: comportamiento original (solo Map local)
 * - redis: fan-out vía Redis PubSub (cada réplica mantiene Map local, pero broadcast publica en Redis y sub replica el fan-out local)
 * Feature flag: SSE_ADAPTER=memory|redis (default memory). En prod docker-compose debe setear `SSE_ADAPTER=redis`.
 */
export async function initSseBroker(opts?: {
  host?: string;
  port?: number;
  password?: string;
  adapter?: SseAdapter;
}): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (opts?.adapter) adapter = opts.adapter;
  if (adapter !== "redis") {
    console.log(`[sse:broker] adapter=memory (clients local only)`);
    return;
  }

  const host = opts?.host ?? process.env.REDIS_HOST ?? "redis";
  const port = Number(opts?.port ?? process.env.REDIS_PORT ?? 6379);
  const password = opts?.password ?? process.env.REDIS_PASSWORD;

  try {
    const mod = (await import("ioredis")) as unknown as {
      default?: RedisConstructor;
    };
    const Redis = mod.default ?? (mod as unknown as RedisConstructor);
    const connection = {
      host,
      port,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      ...(password ? { password } : {}),
    };
    pub = new Redis(connection);
    sub = new Redis(connection);

    pub.on("error", (e: unknown) =>
      console.error("[sse:broker] pub redis error", e instanceof Error ? e.message : String(e))
    );
    sub.on("error", (e: unknown) =>
      console.error("[sse:broker] sub redis error", e instanceof Error ? e.message : String(e))
    );

    await Promise.all([pub.connect(), sub.connect()]);
    await sub.subscribe(CHANNEL);

    sub.on("message", (channel: string, message: string) => {
      if (channel !== CHANNEL) return;
      try {
        const { eventType, data } = JSON.parse(message) as { eventType: string; data: unknown };
        localBroadcast(eventType, data);
      } catch (e) {
        console.error("[sse:broker] failed to parse redis message", e);
      }
    });

    console.log(`[sse:broker] adapter=redis channel=${CHANNEL} host=${host}:${port}`);
  } catch (e) {
    console.error("[sse:broker] redis init failed, fallback to memory", e);
    adapter = "memory";
    try {
      await pub?.quit();
    } catch {
      void 0;
    }
    try {
      await sub?.quit();
    } catch {
      void 0;
    }
    pub = null;
    sub = null;
  }
}

export function addClient(res: ServerResponse, maxClients = 100): string | null {
  if (clients.size >= maxClients) return null;
  const id = randomUUID();
  clients.set(id, res);
  return id;
}

export function removeClient(id: string): void {
  clients.delete(id);
}

/**
 * Broadcast a SSE event.
 * - memory: write directly to local clients
 * - redis: publish to Redis channel (all replicas fan-out locally via sub handler).
 *            If publish fails, fallback to local.
 */
export async function broadcast(eventType: string, data: unknown): Promise<void> {
  if (adapter === "redis" && pub) {
    try {
      const payload = JSON.stringify({ eventType, data });
      await pub.publish(CHANNEL, payload);
      return;
    } catch (e) {
      console.error("[sse:broker] publish failed, fallback local", e);
      localBroadcast(eventType, data);
      return;
    }
  }
  localBroadcast(eventType, data);
}

/** Sync variant for call sites que no esperan (compat) — no usar en nuevo código */
export function broadcastSync(eventType: string, data: unknown): void {
  void broadcast(eventType, data).catch(() => void 0);
}

export function clientCount(): number {
  return clients.size;
}

export function getSseAdapter(): SseAdapter {
  return adapter;
}

export async function closeSseBroker(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (pub) tasks.push(pub.quit().catch(() => void 0));
  if (sub) tasks.push(sub.quit().catch(() => void 0));
  await Promise.all(tasks);
  pub = null;
  sub = null;
  initialized = false;
}
