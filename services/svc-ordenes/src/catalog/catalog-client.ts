import type { CrearOrdenDTO } from "../domain/orden.schema.js";

interface CatalogProduct {
  id: string;
  sku: string;
  precio: number;
  activo: boolean;
}

export class CatalogUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogUnavailableError";
  }
}

export class CatalogMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogMismatchError";
  }
}

function catalogUrl(): string {
  return (process.env.PRODUCTOS_SERVICE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

function requestTimeoutMs(): number {
  const parsed = Number(process.env.CATALOG_REQUEST_TIMEOUT_MS ?? 1500);
  return Number.isInteger(parsed) && parsed >= 100 ? parsed : 1500;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

async function getProduct(productId: string): Promise<CatalogProduct> {
  let response: Response;
  try {
    response = await fetch(`${catalogUrl()}/api/v1/productos/${encodeURIComponent(productId)}`, {
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
  } catch (err) {
    throw new CatalogUnavailableError(
      `No se pudo consultar el catálogo para ${productId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (response.status === 404) {
    throw new CatalogMismatchError(`Producto ${productId} no existe en el catálogo`);
  }
  if (!response.ok) {
    throw new CatalogUnavailableError(
      `El catálogo respondió ${response.status} al consultar ${productId}`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new CatalogUnavailableError(
      `Respuesta inválida del catálogo para ${productId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const data = (body as { data?: Record<string, unknown> }).data;
  const precio = Number(data?.precio);
  if (
    !data ||
    data.id !== productId ||
    typeof data.sku !== "string" ||
    !Number.isFinite(precio) ||
    typeof data.activo !== "boolean"
  ) {
    throw new CatalogUnavailableError(`Respuesta incompleta del catálogo para ${productId}`);
  }

  return { id: productId, sku: data.sku, precio, activo: data.activo };
}

/**
 * Verifies client-provided line snapshots and returns canonical catalog values.
 * The synchronous call is an interim safeguard until orders owns a catalog read model.
 */
export async function canonicalizarLineas(
  lineas: CrearOrdenDTO["lineas"]
): Promise<CrearOrdenDTO["lineas"]> {
  const products = new Map<string, CatalogProduct>();
  const productIds = [...new Set(lineas.map((linea) => linea.productoId))];
  const fetched = await Promise.all(
    productIds.map(async (id) => [id, await getProduct(id)] as const)
  );
  for (const [id, product] of fetched) products.set(id, product);

  return lineas.map((linea) => {
    const product = products.get(linea.productoId);
    if (!product || !product.activo) {
      throw new CatalogMismatchError(`Producto ${linea.productoId} no está activo`);
    }
    if (product.sku !== linea.sku || cents(product.precio) !== cents(linea.precioUnitario)) {
      throw new CatalogMismatchError(
        `SKU o precio no coinciden con el catálogo para el producto ${linea.productoId}`
      );
    }
    return { ...linea, sku: product.sku, precioUnitario: product.precio };
  });
}
