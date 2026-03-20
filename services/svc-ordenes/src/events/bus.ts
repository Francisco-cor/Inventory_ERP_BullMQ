import { createEventBus } from "@erp/event-bus";

export const eventBus = createEventBus({
  serviceName: "svc-ordenes",
  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
});
