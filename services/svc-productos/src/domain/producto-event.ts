export interface ProductoDbRowForEvent {
  id: string;
  sku: string;
  nombre: string;
  descripcion: string | null;
  precio: number | string;
  unidad: string | null;
  activo: boolean;
}

/** Normalizes PostgreSQL's row representation to the public event contract. */
export function toProductoCreadoEvent(producto: ProductoDbRowForEvent) {
  return {
    producto: {
      id: producto.id,
      sku: producto.sku,
      nombre: producto.nombre,
      ...(producto.descripcion === null ? {} : { descripcion: producto.descripcion }),
      precio: Number(producto.precio),
      ...(producto.unidad === null ? {} : { unidad: producto.unidad }),
      activo: producto.activo,
    },
  };
}
