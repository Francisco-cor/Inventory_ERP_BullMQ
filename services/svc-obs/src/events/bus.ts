import { createEventBus } from "@erp/event-bus";

const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);

export const eventBus = createEventBus({
  serviceName: "svc-obs",
  redis: { host: REDIS_HOST, port: REDIS_PORT },
});
