export type StockAlertType = "stock_agotado" | "stock_bajo";

export interface ReservationDecision {
  suficiente: boolean;
  disponible: number;
  requerido: number;
  restante: number;
}

export function evaluarReserva(disponible: number, requerido: number): ReservationDecision {
  if (!Number.isInteger(disponible) || disponible < 0) {
    throw new RangeError("disponible debe ser un entero no negativo");
  }
  if (!Number.isInteger(requerido) || requerido < 1) {
    throw new RangeError("requerido debe ser un entero positivo");
  }
  return {
    suficiente: disponible >= requerido,
    disponible,
    requerido,
    restante: disponible >= requerido ? disponible - requerido : disponible,
  };
}

export function tipoAlertaStock(disponible: number, umbral: number): StockAlertType | null {
  if (!Number.isInteger(disponible) || disponible < 0) {
    throw new RangeError("disponible debe ser un entero no negativo");
  }
  if (!Number.isInteger(umbral) || umbral < 1) {
    throw new RangeError("umbral debe ser un entero positivo");
  }
  if (disponible >= umbral) return null;
  return disponible === 0 ? "stock_agotado" : "stock_bajo";
}
