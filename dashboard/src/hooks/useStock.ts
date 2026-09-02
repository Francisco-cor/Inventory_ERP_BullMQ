import { useQuery } from "@tanstack/react-query";

export interface StockAlertItem {
  id: string;
  productoId: string;
  sku: string;
  disponible: number;
  umbral: number;
  resuelta: boolean;
  creadaEn: string;
}

async function fetchStockAlerts(apiBase: string): Promise<StockAlertItem[]> {
  const res = await fetch(`${apiBase}/api/v1/stock/alertas`);
  if (!res.ok) throw new Error(`Failed to fetch alerts: ${res.status}`);
  const json = await res.json();
  return json.data ?? [];
}

export function useStockAlerts(apiBase: string, enabled = true) {
  return useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => fetchStockAlerts(apiBase),
    enabled,
    // No polling — invalidated by SSE (replaces StockAlerts.tsx:38 15s interval)
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  });
}

export interface StockLevel {
  productoId: string;
  sku: string;
  disponible: number;
  reservado: number;
  umbral?: number;
}

export function useStockLevels(apiBase: string) {
  return useQuery({
    queryKey: ["stock-levels"],
    queryFn: async (): Promise<StockLevel[]> => {
      // Try to fetch via obs or stock service; fallback empty
      // For now, fetch alerts and derive levels
      const alerts = await fetchStockAlerts(apiBase);
      return alerts.map((a) => ({
        productoId: a.productoId,
        sku: a.sku,
        disponible: a.disponible,
        reservado: 0,
        umbral: a.umbral,
      }));
    },
    staleTime: 10_000,
  });
}

export function useProducts(apiBase: string) {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/api/v1/productos`);
      if (!res.ok) throw new Error("Failed to fetch products");
      const json = await res.json();
      return json.data ?? [];
    },
    staleTime: 10_000,
  });
}
