import { useQuery } from "@tanstack/react-query";
import type { OrdenSla } from "../types.js";

export interface OrdersSlaResponse {
  data: OrdenSla[];
}

async function fetchOrdersSla(apiBase: string): Promise<OrdenSla[]> {
  const res = await fetch(`${apiBase}/api/v1/obs/sla/ordenes`);
  if (!res.ok) throw new Error(`Failed to fetch orders SLA: ${res.status}`);
  const json = (await res.json()) as OrdersSlaResponse;
  return json.data ?? [];
}

export function useOrdersSla(apiBase: string, enabled = true) {
  return useQuery({
    queryKey: ["orders-sla"],
    queryFn: () => fetchOrdersSla(apiBase),
    enabled,
    // No polling — SSE invalidates (8.2). Remove setInterval from OrdersTable.tsx:44
    refetchOnWindowFocus: false,
    staleTime: 5_000,
    retry: 2,
  });
}

export async function fetchOrderDetail(apiBase: string, ordenId: string) {
  const res = await fetch(`${apiBase}/api/v1/ordenes/${ordenId}`);
  if (!res.ok) throw new Error(`Order ${ordenId} not found`);
  const json = await res.json();
  return json.data ?? json;
}

export function useOrderDetail(apiBase: string, ordenId: string | null) {
  return useQuery({
    queryKey: ["order-detail", ordenId],
    queryFn: () => fetchOrderDetail(apiBase, ordenId!),
    enabled: !!ordenId,
  });
}
