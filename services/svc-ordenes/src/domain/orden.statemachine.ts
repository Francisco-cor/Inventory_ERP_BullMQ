/**
 * Máquina de estados para órdenes.
 * Define las transiciones válidas de forma explícita en código.
 *
 * Estados:
 *   pendiente → confirmada  (cuando svc-stock emite stock.reservado)
 *   pendiente → cancelada   (cancelación manual o stock insuficiente)
 *   confirmada → (sin transiciones)
 *   cancelada  → (sin transiciones)
 */

export const ESTADOS_ORDEN = ["pendiente", "confirmada", "cancelada"] as const;
export type EstadoOrden = (typeof ESTADOS_ORDEN)[number];

const TRANSICIONES_VALIDAS: Record<EstadoOrden, readonly EstadoOrden[]> = {
  pendiente: ["confirmada", "cancelada"],
  confirmada: [],
  cancelada: [],
} as const;

export function puedeTransicionar(
  actual: EstadoOrden,
  siguiente: EstadoOrden
): boolean {
  return (TRANSICIONES_VALIDAS[actual] as readonly string[]).includes(siguiente);
}

export function describir(estado: EstadoOrden): string {
  const validas = TRANSICIONES_VALIDAS[estado];
  return validas.length > 0
    ? `Estado '${estado}'. Transiciones válidas: [${validas.join(", ")}]`
    : `Estado '${estado}' es terminal (sin transiciones posibles)`;
}

export class TransicionInvalidaError extends Error {
  readonly actual: EstadoOrden;
  readonly siguiente: EstadoOrden;

  constructor(actual: EstadoOrden, siguiente: EstadoOrden) {
    const validas = TRANSICIONES_VALIDAS[actual];
    const msg =
      validas.length > 0
        ? `Transición inválida: '${actual}' → '${siguiente}'. Válidas desde '${actual}': [${validas.join(", ")}]`
        : `Orden en estado '${actual}' es terminal y no permite más transiciones`;
    super(msg);
    this.name = "TransicionInvalidaError";
    this.actual = actual;
    this.siguiente = siguiente;
  }
}
