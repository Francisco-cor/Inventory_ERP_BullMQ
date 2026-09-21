import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizarLineas,
  CatalogMismatchError,
  CatalogUnavailableError,
} from "./catalog-client.js";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111001";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PRODUCTOS_SERVICE_URL;
  delete process.env.CATALOG_REQUEST_TIMEOUT_MS;
});

function line(precioUnitario = 89.99) {
  return { productoId: PRODUCT_ID, sku: "SKU-001", cantidad: 2, precioUnitario };
}

function catalogResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      data: { id: PRODUCT_ID, sku: "SKU-001", precio: 89.99, activo: true, ...overrides },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("catalog-client", () => {
  it("returns canonical values and fetches duplicated products once", async () => {
    const fetchMock = vi.fn().mockResolvedValue(catalogResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await canonicalizarLineas([line(), line()]);

    expect(result).toEqual([line(), line()]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a client price or SKU that differs from the catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(catalogResponse()));

    await expect(canonicalizarLineas([line(1)])).rejects.toBeInstanceOf(CatalogMismatchError);
  });

  it("rejects inactive products", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(catalogResponse({ activo: false })));

    await expect(canonicalizarLineas([line()])).rejects.toBeInstanceOf(CatalogMismatchError);
  });

  it("maps catalog network failures to an unavailable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(canonicalizarLineas([line()])).rejects.toBeInstanceOf(CatalogUnavailableError);
  });
});
