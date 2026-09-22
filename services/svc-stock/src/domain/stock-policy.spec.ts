import { describe, expect, it } from "vitest";
import { evaluarReserva, tipoAlertaStock } from "./stock-policy.js";

describe("stock policy", () => {
  it("allows exact and partial reservations without negative remaining stock", () => {
    expect(evaluarReserva(5, 5)).toEqual({
      suficiente: true,
      disponible: 5,
      requerido: 5,
      restante: 0,
    });
    expect(evaluarReserva(10, 3).restante).toBe(7);
  });

  it("rejects reservations that exceed availability", () => {
    expect(evaluarReserva(2, 3)).toMatchObject({ suficiente: false, restante: 2 });
  });

  it("validates stock inputs", () => {
    expect(() => evaluarReserva(-1, 1)).toThrow(RangeError);
    expect(() => evaluarReserva(1, 0)).toThrow(RangeError);
  });

  it("classifies low-stock alerts", () => {
    expect(tipoAlertaStock(10, 10)).toBeNull();
    expect(tipoAlertaStock(4, 10)).toBe("stock_bajo");
    expect(tipoAlertaStock(0, 10)).toBe("stock_agotado");
  });
});
