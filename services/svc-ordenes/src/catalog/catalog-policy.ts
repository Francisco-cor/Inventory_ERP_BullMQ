import type { CrearOrdenDTO } from "../domain/orden.schema.js";

export interface CatalogSnapshot {
  productoId: string;
  sku: string;
  precio: number;
  activo: boolean;
  versionPrecio: number;
}

export class CatalogProjectionNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogProjectionNotReadyError";
  }
}

export class CatalogProjectionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogProjectionMismatchError";
  }
}

export type CatalogLookup = (productIds: string[]) => Promise<CatalogSnapshot[]>;

function cents(value: number): number {
  return Math.round(value * 100);
}

export async function canonicalizarDesdeProyeccion(
  lineas: CrearOrdenDTO["lineas"],
  lookup: CatalogLookup
): Promise<Array<CrearOrdenDTO["lineas"][number] & { versionPrecio: number }>> {
  const productIds = [...new Set(lineas.map((linea) => linea.productoId))];
  const snapshots = new Map(
    (await lookup(productIds)).map((product) => [product.productoId, product])
  );

  return lineas.map((linea) => {
    const product = snapshots.get(linea.productoId);
    if (!product) {
      throw new CatalogProjectionNotReadyError(
        `La proyección de catálogo aún no contiene el producto ${linea.productoId}`
      );
    }
    if (!product.activo) {
      throw new CatalogProjectionMismatchError(`Producto ${linea.productoId} no está activo`);
    }
    if (product.sku !== linea.sku || cents(product.precio) !== cents(linea.precioUnitario)) {
      throw new CatalogProjectionMismatchError(
        `SKU o precio no coinciden con la proyección para el producto ${linea.productoId}`
      );
    }
    return {
      ...linea,
      sku: product.sku,
      precioUnitario: product.precio,
      versionPrecio: product.versionPrecio,
    };
  });
}
