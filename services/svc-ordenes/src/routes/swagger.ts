import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "svc-ordenes API",
        description: "Servicio de gestión de órdenes del ERP de inventario",
        version: "1.0.0",
      },
      tags: [{ name: "ordenes", description: "CRUD de órdenes" }],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list" },
  });
}
