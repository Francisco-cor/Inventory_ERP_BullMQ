import { z } from "zod";

// Schemas for each domain event payload — used for validation in publisher and consumer.
// Keep in sync with @erp/shared-types.

export const ProductoCreadoSchema = z.object({
  producto: z.object({
    id: z.string().uuid(),
    sku: z.string().min(1),
    nombre: z.string().min(1),
    precio: z.number().min(0),
    unidad: z.string().optional(),
    descripcion: z.string().optional(),
    activo: z.boolean().optional(),
  }),
});

export const ProductoActualizadoSchema = z.object({
  productoId: z.string().uuid(),
  cambios: z.record(z.unknown()),
});

export const ProductoEliminadoSchema = z.object({ productoId: z.string().uuid() });

export const OrdenCreadaSchema = z.object({
  orden: z.object({
    id: z.string().uuid(),
    estado: z.string(),
    lineas: z.array(
      z.object({
        productoId: z.string().uuid(),
        sku: z.string(),
        cantidad: z.number().int().min(1),
        precioUnitario: z.number().min(0),
      })
    ),
    total: z.number(),
    creadaEn: z.string(),
    actualizadaEn: z.string().optional(),
  }),
});

export const OrdenConfirmadaSchema = z.object({
  ordenId: z.string().uuid(),
  confirmadaEn: z.string(),
});

export const OrdenCanceladaSchema = z.object({
  ordenId: z.string().uuid(),
  motivo: z.string().optional(),
});

export const StockReservadoSchema = z.object({
  ordenId: z.string().uuid(),
  items: z.array(z.object({ productoId: z.string().uuid(), cantidad: z.number().int().min(1) })),
});

export const StockInsuficienteSchema = z.object({
  ordenId: z.string().uuid(),
  sku: z.string(),
  disponible: z.number().int().min(0),
  requerido: z.number().int().min(1),
});

export const StockLiberadoSchema = z.object({
  ordenId: z.string().uuid(),
  items: z.array(z.object({ productoId: z.string().uuid(), cantidad: z.number().int().min(1) })),
});

export const StockAjustadoSchema = z.object({
  productoId: z.string().uuid(),
  delta: z.number().int(),
  motivo: z.string().min(1),
});

export const StockAlertaSchema = z.object({
  productoId: z.string().uuid(),
  sku: z.string(),
  disponible: z.number().int(),
  umbral: z.number().int(),
  tipo: z.string(),
});

export const SlaWarningSchema = z.object({
  ordenId: z.string().uuid(),
  creadaEn: z.string(),
  segundosPendiente: z.number().int().min(0),
});

export const eventSchemas: Record<string, z.ZodSchema> = {
  "producto.creado": ProductoCreadoSchema,
  "producto.actualizado": ProductoActualizadoSchema,
  "producto.eliminado": ProductoEliminadoSchema,
  "orden.creada": OrdenCreadaSchema,
  "orden.confirmada": OrdenConfirmadaSchema,
  "orden.cancelada": OrdenCanceladaSchema,
  "stock.reservado": StockReservadoSchema,
  "stock.insuficiente": StockInsuficienteSchema,
  "stock.liberado": StockLiberadoSchema,
  "stock.ajustado": StockAjustadoSchema,
  "stock.alerta": StockAlertaSchema,
  "sla.warning": SlaWarningSchema,
};

export function validateEventPayload(eventName: string, payload: unknown): void {
  const schema = eventSchemas[eventName];
  if (!schema) return; // unknown event, no validation
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `ValidationError: payload inválido para ${eventName}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
}
