import { useParams, Link } from "react-router-dom";
import { useOrderDetail } from "../hooks/useOrders.js";
import { useSse } from "../hooks/useSse.js";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card.js";
import { Badge } from "../components/ui/badge.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Button } from "../components/ui/button.js";

const API_BASE = "";
const SSE_URL = "/api/v1/obs/events/stream";

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useOrderDetail(API_BASE, id ?? null);
  const { events } = useSse({ sseUrl: SSE_URL });

  const relatedEvents = events.filter((e) => {
    const payload = e.payload as Record<string, unknown>;
    return (
      payload.ordenId === id ||
      (payload.orden as Record<string, unknown>)?.id === id ||
      payload.id === id
    );
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Card className="border-red-900 bg-red-950/20">
          <CardContent className="p-4">
            <p className="text-sm text-red-400">Error: {(error as Error).message}</p>
            <Link to="/">
              <Button variant="outline" size="sm" className="mt-2">
                Volver
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!order) {
    return <div className="p-4 text-sm text-muted-foreground">Orden no encontrada</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/">
          <Button variant="ghost" size="sm">
            ← Volver
          </Button>
        </Link>
        <h2 className="text-lg font-semibold">Orden {id?.slice(0, 8)}</h2>
        <Badge variant="outline" className="ml-2">
          {order.estado ?? order.estadoSla ?? "pendiente"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Detalle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ID</span>
              <code className="text-xs">{order.id ?? id}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estado</span>
              <span>{order.estado}</span>
            </div>
            {order.total && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span>${order.total}</span>
              </div>
            )}
            {order.correlationId && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">CorrelationId</span>
                <code className="text-xs">{String(order.correlationId).slice(0, 8)}</code>
              </div>
            )}
            {order.creadaEn && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Creada</span>
                <span>{new Date(order.creadaEn).toLocaleString()}</span>
              </div>
            )}
            <div className="mt-2">
              <p className="text-xs font-semibold">Líneas</p>
              <pre className="mt-1 rounded bg-muted p-2 text-xs overflow-auto">
                {JSON.stringify(order.lineas ?? order.items ?? [], null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline — Eventos correlacionados</CardTitle>
          </CardHeader>
          <CardContent>
            {relatedEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin eventos SSE para esta orden aún. Los eventos aparecerán en vivo.
              </p>
            ) : (
              <div className="space-y-2">
                {relatedEvents.slice(-20).map((e) => (
                  <div
                    key={e.eventId}
                    className="flex gap-2 text-xs border-l-2 border-primary/30 pl-3 py-1"
                  >
                    <span className="font-semibold">{e.eventName}</span>
                    <span className="text-muted-foreground">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">
                Total eventos en buffer: {events.length}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
