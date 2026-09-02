import { describe, it, expect } from "vitest";
import { CrearProductoSchema, ActualizarProductoSchema } from "./producto.schema.js";

describe("producto.schema", () => {
  describe("CrearProductoSchema", () => {
    it("válido con sku, nombre, precio", () => {
      expect(
        CrearProductoSchema.safeParse({ sku: "SKU-001", nombre: "Teclado", precio: 99.99 }).success
      ).toBe(true);
    });

    it("aplica default unidad=unidad", () => {
      const parsed = CrearProductoSchema.safeParse({ sku: "A", nombre: "B", precio: 10 });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.unidad).toBe("unidad");
    });

    it("rechaza sku vacío", () => {
      expect(CrearProductoSchema.safeParse({ sku: "", nombre: "A", precio: 10 }).success).toBe(
        false
      );
    });

    it("rechaza sku >100", () => {
      expect(
        CrearProductoSchema.safeParse({ sku: "A".repeat(101), nombre: "B", precio: 10 }).success
      ).toBe(false);
    });

    it("rechaza nombre vacío", () => {
      expect(CrearProductoSchema.safeParse({ sku: "A", nombre: "", precio: 10 }).success).toBe(
        false
      );
    });

    it("rechaza precio negativo", () => {
      expect(CrearProductoSchema.safeParse({ sku: "A", nombre: "B", precio: -1 }).success).toBe(
        false
      );
    });

    it("acepta precio 0", () => {
      expect(CrearProductoSchema.safeParse({ sku: "A", nombre: "B", precio: 0 }).success).toBe(
        true
      );
    });

    it("acepta descripcion opcional", () => {
      expect(
        CrearProductoSchema.safeParse({ sku: "A", nombre: "B", precio: 10, descripcion: "desc" })
          .success
      ).toBe(true);
    });

    it("rechaza precio no numérico", () => {
      expect(
        CrearProductoSchema.safeParse({ sku: "A", nombre: "B", precio: "10" as any }).success
      ).toBe(false);
    });
  });

  describe("ActualizarProductoSchema", () => {
    it("todo opcional: vacío es válido", () => {
      expect(ActualizarProductoSchema.safeParse({}).success).toBe(true);
    });

    it("rechaza nombre vacío si se provee", () => {
      expect(ActualizarProductoSchema.safeParse({ nombre: "" }).success).toBe(false);
    });

    it("acepta precio y activo", () => {
      expect(ActualizarProductoSchema.safeParse({ precio: 20, activo: true }).success).toBe(true);
    });

    it("rechaza precio negativo", () => {
      expect(ActualizarProductoSchema.safeParse({ precio: -5 }).success).toBe(false);
    });
  });
});
