/**
 * Typed event name constants — no magic strings in service code.
 * Import EVENTS and use EVENTS.ORDEN_CREADA instead of "orden.creada".
 */
export const EVENTS = {
  PRODUCTO_CREADO:      "producto.creado",
  PRODUCTO_ACTUALIZADO: "producto.actualizado",
  PRODUCTO_ELIMINADO:   "producto.eliminado",
  ORDEN_CREADA:         "orden.creada",
  ORDEN_CONFIRMADA:     "orden.confirmada",
  ORDEN_CANCELADA:      "orden.cancelada",
  STOCK_RESERVADO:      "stock.reservado",
  STOCK_INSUFICIENTE:   "stock.insuficiente",
  STOCK_LIBERADO:       "stock.liberado",
  STOCK_AJUSTADO:       "stock.ajustado",
  STOCK_ALERTA:         "stock.alerta",
} as const;
