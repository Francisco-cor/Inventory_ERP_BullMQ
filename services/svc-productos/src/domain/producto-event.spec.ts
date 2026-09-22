import { describe, expect, it } from "vitest";
import { toProductoCreadoEvent } from "./producto-event.js";

describe("toProductoCreadoEvent", () => {
  it("normaliza precio numérico y omite descripción nula", () => {
    const result = toProductoCreadoEvent({
      id: "00000000-0000-4000-8000-000000000001",
      sku: "SKU-1",
      nombre: "Producto",
      descripcion: null,
      precio: "19.90",
      unidad: "pza",
      activo: true,
    });

    expect(result.producto.precio).toBe(19.9);
    expect(result.producto).not.toHaveProperty("descripcion");
  });

  it("preserva descripción y unidad cuando PostgreSQL las devuelve", () => {
    const result = toProductoCreadoEvent({
      id: "00000000-0000-4000-8000-000000000001",
      sku: "SKU-1",
      nombre: "Producto",
      descripcion: "Descripción",
      precio: 19.9,
      unidad: "pza",
      activo: true,
    });

    expect(result.producto).toMatchObject({ descripcion: "Descripción", unidad: "pza" });
  });
});
