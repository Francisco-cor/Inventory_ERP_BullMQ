import { describe, expect, it } from "vitest";
import {
  canonicalizarDesdeProyeccion,
  CatalogProjectionMismatchError,
  CatalogProjectionNotReadyError,
} from "./catalog-policy.js";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111001";
const line = { productoId: PRODUCT_ID, sku: "SKU-001", cantidad: 2, precioUnitario: 89.99 };

describe("catalog read model policy", () => {
  it("canonicalizes from the local snapshot and preserves price version", async () => {
    const result = await canonicalizarDesdeProyeccion([line], async () => [
      { productoId: PRODUCT_ID, sku: "SKU-001", precio: 89.99, activo: true, versionPrecio: 4 },
    ]);

    expect(result[0]).toMatchObject({ ...line, versionPrecio: 4 });
  });

  it("rejects while the projection is missing the product", async () => {
    await expect(canonicalizarDesdeProyeccion([line], async () => [])).rejects.toBeInstanceOf(
      CatalogProjectionNotReadyError
    );
  });

  it("rejects inactive products and stale client pricing", async () => {
    await expect(
      canonicalizarDesdeProyeccion([line], async () => [
        { productoId: PRODUCT_ID, sku: "SKU-001", precio: 89.99, activo: false, versionPrecio: 1 },
      ])
    ).rejects.toBeInstanceOf(CatalogProjectionMismatchError);

    await expect(
      canonicalizarDesdeProyeccion([{ ...line, precioUnitario: 1 }], async () => [
        { productoId: PRODUCT_ID, sku: "SKU-001", precio: 89.99, activo: true, versionPrecio: 1 },
      ])
    ).rejects.toBeInstanceOf(CatalogProjectionMismatchError);
  });
});
