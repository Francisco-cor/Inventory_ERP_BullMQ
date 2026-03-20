// ─── Event Bus Types ──────────────────────────────────────────────────────────

export type EventName =
  | "producto.creado"
  | "producto.actualizado"
  | "producto.eliminado"
  | "orden.creada"
  | "orden.confirmada"
  | "orden.cancelada"
  | "stock.reservado"
  | "stock.insuficiente"
  | "stock.liberado"
  | "stock.ajustado"
  | "stock.alerta";

export interface DomainEvent<T = unknown> {
  id: string;
  name: EventName;
  payload: T;
  timestamp: string;      // ISO 8601
  source: ServiceName;
  correlationId: string;
}

export type ServiceName = "svc-productos" | "svc-ordenes" | "svc-stock" | "svc-obs";

// ─── Producto ─────────────────────────────────────────────────────────────────

export interface Producto {
  id: string;
  sku: string;
  nombre: string;
  descripcion?: string;
  precio: number;
  unidad: string;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

export interface ProductoCreadoPayload {
  producto: Producto;
}

export interface ProductoActualizadoPayload {
  productoId: string;
  cambios: Partial<Omit<Producto, "id" | "creadoEn">>;
}

export interface ProductoEliminadoPayload {
  productoId: string;
}

// ─── Orden ────────────────────────────────────────────────────────────────────

export type EstadoOrden = "pendiente" | "confirmada" | "cancelada";

export interface LineaOrden {
  productoId: string;
  sku: string;
  cantidad: number;
  precioUnitario: number;
}

export interface Orden {
  id: string;
  estado: EstadoOrden;
  lineas: LineaOrden[];
  total: number;
  creadaEn: string;
  actualizadaEn: string;
}

export interface OrdenCreadaPayload {
  orden: Orden;
}

export interface OrdenConfirmadaPayload {
  ordenId: string;
  confirmadaEn: string;
}

export interface OrdenCanceladaPayload {
  ordenId: string;
  motivo?: string;
}

// ─── Stock ────────────────────────────────────────────────────────────────────

export interface StockItem {
  productoId: string;
  sku: string;
  disponible: number;
  reservado: number;
  total: number;
  actualizadoEn: string;
}

export interface StockReservadoPayload {
  ordenId: string;
  items: Array<{ productoId: string; cantidad: number }>;
}

export interface StockInsuficientePayload {
  ordenId: string;
  sku: string;
  disponible: number;
  requerido: number;
}

export interface StockLiberadoPayload {
  ordenId: string;
  items: Array<{ productoId: string; cantidad: number }>;
}

export interface StockAjustadoPayload {
  productoId: string;
  delta: number;
  motivo: string;
}

// ─── Observability ────────────────────────────────────────────────────────────

export interface EventLogEntry {
  eventId: string;
  eventName: EventName;
  source: ServiceName;
  correlationId: string;
  timestamp: string;
  procesadoEn?: string;
  latenciaMs?: number;
  estado: "emitido" | "procesado" | "fallido";
  error?: string;
}

export interface AlertaOrdenPendiente {
  ordenId: string;
  creadaEn: string;
  segundosPendiente: number;
}

// ─── API Response Wrappers ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}
