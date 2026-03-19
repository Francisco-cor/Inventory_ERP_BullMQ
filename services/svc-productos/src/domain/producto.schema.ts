import { z } from "zod";

export const CrearProductoSchema = z.object({
  sku: z.string().min(1).max(100),
  nombre: z.string().min(1).max(255),
  descripcion: z.string().optional(),
  precio: z.number().nonnegative(),
  unidad: z.string().min(1).max(50).default("unidad"),
});

export const ActualizarProductoSchema = z.object({
  nombre: z.string().min(1).max(255).optional(),
  descripcion: z.string().optional(),
  precio: z.number().nonnegative().optional(),
  unidad: z.string().min(1).max(50).optional(),
  activo: z.boolean().optional(),
});

export type CrearProductoDTO = z.infer<typeof CrearProductoSchema>;
export type ActualizarProductoDTO = z.infer<typeof ActualizarProductoSchema>;
