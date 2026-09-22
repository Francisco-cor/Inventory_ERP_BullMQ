import { pool } from "../db/pool.js";
import type { CrearOrdenDTO } from "../domain/orden.schema.js";
import {
  CatalogProjectionMismatchError,
  canonicalizarDesdeProyeccion,
  CatalogProjectionNotReadyError,
  type CatalogSnapshot,
} from "./catalog-policy.js";

const PROJECTION_WAIT_MS = Math.max(0, Number(process.env.CATALOG_PROJECTION_WAIT_MS ?? 1_500));
const PROJECTION_RETRY_MS = Math.max(25, Number(process.env.CATALOG_PROJECTION_RETRY_MS ?? 100));

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function canonicalizarLineasDesdeCatalogoLocal(
  lineas: CrearOrdenDTO["lineas"]
): Promise<Array<CrearOrdenDTO["lineas"][number] & { versionPrecio: number }>> {
  const deadline = Date.now() + PROJECTION_WAIT_MS;
  while (true) {
    try {
      return await canonicalizarDesdeProyeccion(lineas, async (productIds) => {
        const { rows } = await pool.query<CatalogSnapshot>(
          `SELECT producto_id AS "productoId", sku, precio::float8 AS precio,
                  activo, version_precio AS "versionPrecio"
           FROM catalogo_productos
           WHERE producto_id = ANY($1::uuid[])`,
          [productIds]
        );
        return rows;
      });
    } catch (err) {
      if (err instanceof CatalogProjectionMismatchError) throw err;
      if (Date.now() >= deadline) {
        if (err instanceof CatalogProjectionNotReadyError) throw err;
        throw new CatalogProjectionNotReadyError(
          "No se pudo consultar la proyección local de catálogo"
        );
      }
      await wait(Math.min(PROJECTION_RETRY_MS, Math.max(0, deadline - Date.now())));
    }
  }
}
