import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "svc-productos API",
        description: "Servicio de gestión de productos del ERP de inventario",
        version: "1.0.0",
      },
      tags: [{ name: "productos", description: "CRUD de productos" }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list" },
  });
}
