import { z } from "zod";

export const LineaOrdenSchema = z.object({
  productoId: z.string().uuid(),
  sku: z.string().min(1),
  cantidad: z.number().int().positive(),
  precioUnitario: z.number().nonnegative(),
});

export const CrearOrdenSchema = z.object({
  lineas: z.array(LineaOrdenSchema).min(1),
});

export type CrearOrdenDTO = z.infer<typeof CrearOrdenSchema>;
