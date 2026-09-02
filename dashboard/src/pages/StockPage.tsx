import { useStockAlerts } from "../hooks/useStock.js";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card.js";
import { StockLevelChart } from "../components/StockLevelChart.js";
import { TableSkeleton } from "../components/ui/skeleton.js";

const API_BASE = "";

export function StockPage() {
  const { data: alerts = [], isLoading } = useStockAlerts(API_BASE);

  return (
    <div className="p-4 space-y-4">
      <StockLevelChart alerts={alerts} />
      <Card>
        <CardHeader>
          <CardTitle>Detalle de Stock — Alertas</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={4} />
          ) : (
            <div className="space-y-2">
              {alerts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Sin alertas</p>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className="flex justify-between border-b py-2 text-sm">
                    <span className="font-mono text-xs">{a.sku}</span>
                    <span className={a.disponible <= a.umbral ? "text-red-400" : "text-green-400"}>
                      {a.disponible} / {a.umbral}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {a.resuelta ? "resuelta" : "activa"}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
