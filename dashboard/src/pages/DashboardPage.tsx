import { useState, useCallback } from "react";
import { useSse } from "../hooks/useSse.js";
import { useOrdersSla } from "../hooks/useOrders.js";
import { useStockAlerts } from "../hooks/useStock.js";
import { EventLog } from "../components/EventLog.js";
import { OrdersTable } from "../components/OrdersTable.js";
import { StockAlerts } from "../components/StockAlerts.js";
import { SlaChart } from "../components/SlaChart.js";
import { StockLevelChart } from "../components/StockLevelChart.js";
import { useToast } from "../components/ui/toast.js";

const SSE_URL = "/api/v1/obs/events/stream";
const API_BASE = "";

export function DashboardPage() {
  const [slaWarningIds, setSlaWarningIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const handleSlaWarning = useCallback(
    (alert: { ordenId: string; creadaEn: string; segundosPendiente: number }) => {
      setSlaWarningIds((prev) => new Set([...prev, alert.ordenId]));
      toast({
        title: "⚠ SLA Warning",
        description: `Orden ${alert.ordenId.slice(0, 8)} pendiente ${alert.segundosPendiente}s`,
        variant: "destructive",
      });
    },
    [toast]
  );

  const { events, connected, clear } = useSse({ sseUrl: SSE_URL, onSlaWarning: handleSlaWarning });
  const { data: ordenes = [] } = useOrdersSla(API_BASE);
  const { data: alerts = [] } = useStockAlerts(API_BASE);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="w-full">
        <EventLog events={events} connected={connected} onClear={clear} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SlaChart ordenes={ordenes} />
        <StockLevelChart alerts={alerts} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <OrdersTable apiBase={API_BASE} slaWarningIds={slaWarningIds} />
        <StockAlerts apiBase={API_BASE} />
      </div>
    </div>
  );
}
