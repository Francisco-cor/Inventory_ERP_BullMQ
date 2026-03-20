import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

// In-memory SSE client registry
const clients = new Map<string, ServerResponse>();

export function addClient(res: ServerResponse): string {
  const id = randomUUID();
  clients.set(id, res);
  return id;
}

export function removeClient(id: string): void {
  clients.delete(id);
}

export function broadcast(eventType: string, data: unknown): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, res] of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(id);
    }
  }
}

export function clientCount(): number {
  return clients.size;
}
