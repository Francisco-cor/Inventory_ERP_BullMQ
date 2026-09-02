import * as React from "react";
import type { EventEntry } from "../types.js";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card.js";
import { Input } from "./ui/input.js";
import { Badge } from "./ui/badge.js";
import { cn } from "../lib/utils.js";

const EVENT_COLORS: Record<string, string> = {
  "orden.creada": "text-[#58a6ff]",
  "orden.confirmada": "text-[#3fb950]",
  "orden.cancelada": "text-[#f85149]",
  "stock.reservado": "text-[#d2a8ff]",
  "stock.insuficiente": "text-[#ffa657]",
  "stock.liberado": "text-[#79c0ff]",
  "stock.alerta": "text-[#ffa657]",
  "stock.ajustado": "text-[#a5d6ff]",
  "producto.creado": "text-[#7ee787]",
  "producto.actualizado": "text-[#e3b341]",
  "producto.eliminado": "text-[#f85149]",
};

interface Props {
  events: EventEntry[];
  connected: boolean;
  onClear?: () => void;
}

const EventRow = React.memo(function EventRow({ ev }: { ev: EventEntry }) {
  return (
    <div className="grid grid-cols-[80px_190px_110px_90px_1fr] gap-2 border-b border-[#21262d] px-4 py-1 text-xs leading-6 hover:bg-[#1f2937]/30">
      <span className="text-muted-foreground">{new Date(ev.timestamp).toLocaleTimeString()}</span>
      <span
        className={cn("font-semibold truncate", EVENT_COLORS[ev.eventName] ?? "text-foreground")}
      >
        {ev.eventName}
      </span>
      <span className="truncate text-muted-foreground">{ev.source}</span>
      <span className="font-mono text-muted-foreground">
        {ev.correlationId?.slice(0, 8) || "no-id"}
      </span>
      <span className="truncate text-muted-foreground">
        {JSON.stringify(ev.payload).slice(0, 80)}
      </span>
    </div>
  );
});

export function EventLog({ events, connected, onClear }: Props) {
  const [filter, setFilter] = React.useState("");
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const autoScroll = React.useRef(true);
  const deferredFilter = React.useDeferredValue(filter);

  // Filter with useMemo to avoid full re-render total (8.2 criterion)
  const filtered = React.useMemo(() => {
    if (!deferredFilter) return events;
    const f = deferredFilter.toLowerCase();
    return events.filter(
      (e) =>
        e.eventName.toLowerCase().includes(f) ||
        e.source.toLowerCase().includes(f) ||
        (e.correlationId?.toLowerCase().includes(f) ?? false)
    );
  }, [events, deferredFilter]);

  React.useEffect(() => {
    if (autoScroll.current && typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [filtered]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-3 border-b bg-[#0d1117] py-3">
        <CardTitle className="flex items-center gap-2 shrink-0">
          <span
            className={cn("h-2 w-2 rounded-full", connected ? "bg-[#3fb950]" : "bg-[#f85149]")}
          />
          Event Log
          <Badge variant="secondary" className="ml-2">
            {events.length}
          </Badge>
          <span className={cn("ml-2 text-xs", connected ? "text-green-400" : "text-red-400")}>
            {connected ? "● conectado" : "○ desconectado"}
          </span>
        </CardTitle>
        <Input
          placeholder="Filtrar por nombre, servicio, correlationId…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="ml-auto max-w-md h-8 text-xs"
        />
        {onClear && (
          <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
            Limpiar
          </button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div
          className="h-[380px] overflow-y-auto py-2"
          onScroll={(e) => {
            const el = e.currentTarget;
            autoScroll.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
          }}
        >
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Esperando eventos…</p>
          ) : (
            filtered.map((ev) => <EventRow key={ev.eventId} ev={ev} />)
          )}
          <div ref={bottomRef} />
        </div>
      </CardContent>
    </Card>
  );
}
