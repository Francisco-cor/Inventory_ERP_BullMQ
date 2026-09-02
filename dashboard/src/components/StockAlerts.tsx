import { useStockAlerts } from "../hooks/useStock.js";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card.js";
import { Badge } from "./ui/badge.js";
import { Skeleton } from "./ui/skeleton.js";

interface Props {
  apiBase: string;
}

export function StockAlerts({ apiBase }: Props) {
  const { data: alerts = [], isLoading, error } = useStockAlerts(apiBase);

  const active = alerts.filter((a) => !a.resuelta);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Alertas de Stock</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-400">Error: {(error as Error).message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b bg-[#0d1117] py-3">
        <CardTitle className="flex items-center gap-2">
          {active.length > 0 && <span className="text-amber-400">⚠</span>} Alertas de Stock
        </CardTitle>
        <Badge variant={active.length ? "warning" : "secondary"} className="ml-auto">
          {active.length} activa{active.length !== 1 ? "s" : ""}
        </Badge>
      </CardHeader>
      <CardContent className="p-3 max-h-[280px] overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : active.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">✓ Sin alertas activas</p>
        ) : (
          <div className="flex flex-col gap-2">
            {active.map((a) => (
              <div key={a.id} className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-amber-400">{a.sku}</span>
                  <span className="text-xs text-foreground">
                    {a.disponible} / {a.umbral} uds
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <code>{a.productoId.slice(0, 13)}…</code>
                  <span>{new Date(a.creadaEn).toLocaleTimeString()}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (a.disponible / a.umbral) * 100)}%`,
                      background: a.disponible === 0 ? "#f85149" : "#ffa657",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
