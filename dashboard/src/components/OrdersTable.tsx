import { useNavigate } from "react-router-dom";
import { useOrdersSla } from "../hooks/useOrders.js";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card.js";
import { Badge } from "./ui/badge.js";
import { TableSkeleton } from "./ui/skeleton.js";
import { cn } from "../lib/utils.js";

const ESTADO_COLOR: Record<string, string> = {
  pendiente: "text-[#e3b341] border-[#e3b341]",
  confirmada: "text-[#3fb950] border-[#3fb950]",
  cancelada: "text-[#f85149] border-[#f85149]",
  sla_warning: "text-[#ff6b6b] border-[#ff6b6b]",
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "PENDIENTE",
  confirmada: "CONFIRMADA",
  cancelada: "CANCELADA",
  sla_warning: "⚠ SLA WARNING",
};

interface Props {
  apiBase: string;
  slaWarningIds?: Set<string>;
}

export function OrdersTable({ apiBase, slaWarningIds }: Props) {
  const { data: ordenes = [], isLoading, error, refetch } = useOrdersSla(apiBase);
  const navigate = useNavigate();

  const displayed = ordenes.map((o) => ({
    ...o,
    estadoSla:
      slaWarningIds?.has(o.ordenId) && o.estadoSla === "pendiente"
        ? ("sla_warning" as const)
        : o.estadoSla,
  }));

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Órdenes — SLA</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-400">
            Error al cargar órdenes: {(error as Error).message}
          </p>
          <button onClick={() => refetch()} className="mt-2 text-xs text-primary underline">
            Reintentar
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-baseline justify-between border-b bg-[#0d1117] py-3">
        <CardTitle>Órdenes — SLA</CardTitle>
        <span className="text-xs text-muted-foreground">
          últimas 100 · SSE en vivo (sin polling)
        </span>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <TableSkeleton rows={5} />
        ) : displayed.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sin órdenes aún</p>
        ) : (
          <div className="max-h-[340px] overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b">
                  {["Orden ID", "Estado", "Creada", "Duración"].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((o) => {
                  const isSla = o.estadoSla === "sla_warning";
                  return (
                    <tr
                      key={o.ordenId}
                      onClick={() => navigate(`/ordenes/${o.ordenId}`)}
                      className={cn(
                        "cursor-pointer border-b border-[#21262d] hover:bg-accent/50 transition-colors",
                        isSla && "bg-red-950/20"
                      )}
                    >
                      <td className="px-4 py-2 text-xs">
                        <code className="text-xs">{o.ordenId.slice(0, 13)}…</code>
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] font-bold tracking-wider",
                            ESTADO_COLOR[o.estadoSla] ?? "text-foreground",
                            isSla && "animate-pulse"
                          )}
                        >
                          {ESTADO_LABEL[o.estadoSla] ?? o.estadoSla}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {new Date(o.creadaEn).toLocaleTimeString()}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2 text-xs",
                          isSla ? "text-red-400" : "text-muted-foreground"
                        )}
                      >
                        {o.duracionSegundos}s
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
