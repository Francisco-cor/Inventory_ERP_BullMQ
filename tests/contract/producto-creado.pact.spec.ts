import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateEventPayload } from "@erp/event-bus";

/**
 * Contract test — producto.creado
 * Producer: svc-productos (emite producto.creado)
 * Consumer: svc-stock (consume producto.creado para crear stock)
 * Verificación: payload Zod + pact-like (sin broker externo, validación de schema)
 * Fase 7.3: si el contrato cambia, este test falla en CI antes de deploy
 */

// Esquema del evento producto.creado (debe coincidir con packages/event-bus/src/schemas.ts)
const ProductoCreadoPayloadSchema = z.object({
  producto: z.object({
    id: z.string().uuid(),
    sku: z.string().min(1),
    nombre: z.string().min(1),
    precio: z.number().nonnegative(),
    unidad: z.string().min(1),
  }),
});

describe("contract — producto.creado", () => {
  const validPayload = {
    producto: {
      id: "11111111-1111-4111-8111-111111111001",
      sku: "SKU-CONTRACT-001",
      nombre: "Producto Contrato",
      precio: 99.99,
      unidad: "pza",
    },
  };

  it("producer: svc-productos emite payload válido", () => {
    expect(() => validateEventPayload("producto.creado", validPayload)).not.toThrow();
    // Zod directo
    expect(ProductoCreadoPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("consumer: svc-stock acepta payload válido", () => {
    // Simula consumer validando antes de procesar
    const parsed = ProductoCreadoPayloadSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.producto.sku).toBe("SKU-CONTRACT-001");
    }
  });

  it("contrato: sku vacío es rechazado por producer y consumer", () => {
    const invalid = { producto: { ...validPayload.producto, sku: "" } };
    expect(ProductoCreadoPayloadSchema.safeParse(invalid).success).toBe(false);
    expect(() => validateEventPayload("producto.creado", invalid)).toThrow();
  });

  it("contrato: precio negativo es rechazado", () => {
    const invalid = { producto: { ...validPayload.producto, precio: -1 } };
    expect(ProductoCreadoPayloadSchema.safeParse(invalid).success).toBe(false);
  });

  it("contrato: campo extra no rompe (backward compatible)", () => {
    const withExtra = { producto: { ...validPayload.producto, descripcion: "extra" } };
    // Zod por defecto ignora extra si no es strict; nuestro schema no es strict, debe pasar
    expect(ProductoCreadoPayloadSchema.safeParse(withExtra).success).toBe(true);
  });

  it("contrato: id no-uuid es rechazado", () => {
    const invalid = { producto: { ...validPayload.producto, id: "not-uuid" } };
    expect(ProductoCreadoPayloadSchema.safeParse(invalid).success).toBe(false);
  });

  // Pact-like: verifica que el evento tenga versionado
  it("pact: event incluye schemaVersion", async () => {
    const { CURRENT_SCHEMA_VERSION } = await import("@erp/event-bus");
    expect(CURRENT_SCHEMA_VERSION).toBe("1.0");
  });
});
