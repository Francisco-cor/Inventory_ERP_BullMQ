import { createEventBus } from "@erp/event-bus";

export const eventBus = createEventBus({
  serviceName: "svc-stock",
  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
});
