import { describe, it, expect } from "vitest";
import { CrearOrdenSchema, LineaOrdenSchema } from "./orden.schema.js";

describe("orden.schema", () => {
  describe("LineaOrdenSchema", () => {
    it("válida con uuid, sku, cantidad, precio", () => {
      const parsed = LineaOrdenSchema.safeParse({
        productoId: "11111111-1111-4111-8111-111111111001",
        sku: "SKU-001",
        cantidad: 2,
        precioUnitario: 99.99,
      });
      expect(parsed.success).toBe(true);
    });

    it("rechaza uuid inválido", () => {
      const parsed = LineaOrdenSchema.safeParse({
        productoId: "not-uuid",
        sku: "SKU-001",
        cantidad: 1,
        precioUnitario: 10,
      });
      expect(parsed.success).toBe(false);
    });

    it("rechaza cantidad 0 o negativa", () => {
      expect(
        LineaOrdenSchema.safeParse({
          productoId: "11111111-1111-4111-8111-111111111001",
          sku: "A",
          cantidad: 0,
          precioUnitario: 10,
        }).success
      ).toBe(false);
      expect(
        LineaOrdenSchema.safeParse({
          productoId: "11111111-1111-4111-8111-111111111001",
          sku: "A",
          cantidad: -1,
          precioUnitario: 10,
        }).success
      ).toBe(false);
    });

    it("rechaza precio negativo", () => {
      expect(
        LineaOrdenSchema.safeParse({
          productoId: "11111111-1111-4111-8111-111111111001",
          sku: "A",
          cantidad: 1,
          precioUnitario: -5,
        }).success
      ).toBe(false);
    });

    it("rechaza sku vacío", () => {
      expect(
        LineaOrdenSchema.safeParse({
          productoId: "11111111-1111-4111-8111-111111111001",
          sku: "",
          cantidad: 1,
          precioUnitario: 10,
        }).success
      ).toBe(false);
    });

    it("acepta precio 0", () => {
      expect(
        LineaOrdenSchema.safeParse({
          productoId: "11111111-1111-4111-8111-111111111001",
          sku: "A",
          cantidad: 1,
          precioUnitario: 0,
        }).success
      ).toBe(true);
    });
  });

  describe("CrearOrdenSchema", () => {
    it("válida con una línea", () => {
      expect(
        CrearOrdenSchema.safeParse({
          lineas: [
            {
              productoId: "11111111-1111-4111-8111-111111111001",
              sku: "A",
              cantidad: 1,
              precioUnitario: 10,
            },
          ],
        }).success
      ).toBe(true);
    });

    it("rechaza lineas vacías", () => {
      expect(CrearOrdenSchema.safeParse({ lineas: [] }).success).toBe(false);
    });

    it("rechaza sin lineas", () => {
      expect(CrearOrdenSchema.safeParse({}).success).toBe(false);
    });

    it("rechaza cantidad no entera", () => {
      expect(
        CrearOrdenSchema.safeParse({
          lineas: [
            {
              productoId: "11111111-1111-4111-8111-111111111001",
              sku: "A",
              cantidad: 1.5,
              precioUnitario: 10,
            },
          ],
        }).success
      ).toBe(false);
    });
  });
});
