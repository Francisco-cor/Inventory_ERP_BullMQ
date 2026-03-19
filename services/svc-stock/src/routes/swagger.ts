import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "svc-stock API",
        description: "Servicio de gestión de stock del ERP de inventario",
        version: "1.0.0",
      },
      tags: [{ name: "stock", description: "Consulta y ajuste de stock" }],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list" },
  });
}
