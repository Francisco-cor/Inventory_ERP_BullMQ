import { createEventBus } from "@erp/event-bus";
import { config } from "../config.js";

export const eventBus = createEventBus({
  serviceName: "svc-stock",
  redis: {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
  },
});
