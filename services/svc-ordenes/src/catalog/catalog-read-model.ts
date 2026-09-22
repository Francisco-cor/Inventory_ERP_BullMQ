import { pool } from "../db/pool.js";
import type { CrearOrdenDTO } from "../domain/orden.schema.js";
import {
  canonicalizarDesdeProyeccion,
  CatalogProjectionNotReadyError,
  type CatalogSnapshot,
} from "./catalog-policy.js";

export async function canonicalizarLineasDesdeCatalogoLocal(
  lineas: CrearOrdenDTO["lineas"]
): Promise<Array<CrearOrdenDTO["lineas"][number] & { versionPrecio: number }>> {
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
    if (err instanceof CatalogProjectionNotReadyError) throw err;
    throw new CatalogProjectionNotReadyError(
      "No se pudo consultar la proyección local de catálogo"
    );
  }
}
