import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { EventEntry } from "../types.js";

const MAX_EVENTS = 200;

export interface UseSseOptions {
  sseUrl: string;
  onSlaWarning?: (alert: { ordenId: string; creadaEn: string; segundosPendiente: number }) => void;
  onEvent?: (entry: EventEntry) => void;
}

export function useSse({ sseUrl, onSlaWarning, onEvent }: UseSseOptions) {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const queryClient = useQueryClient();
  const onSlaRef = useRef(onSlaWarning);
  const onEventRef = useRef(onEvent);
  onSlaRef.current = onSlaWarning;
  onEventRef.current = onEvent;

  const appendEvent = useCallback(
    (entry: EventEntry) => {
      setEvents((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });
      onEventRef.current?.(entry);
      // Invalidate queries that depend on events — replaces polling (8.2)
      // Order SLA and stock alerts are refreshed via SSE, not setInterval
      if (
        entry.eventName.startsWith("orden.") ||
        entry.eventName.startsWith("stock.") ||
        entry.eventName.startsWith("producto.")
      ) {
        queryClient.invalidateQueries({ queryKey: ["orders-sla"] });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
        queryClient.invalidateQueries({ queryKey: ["stock-levels"] });
        queryClient.invalidateQueries({ queryKey: ["products"] });
      }
    },
    [queryClient]
  );

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let active = true;

    function connect() {
      if (!active) return;
      es = new EventSource(sseUrl);

      es.addEventListener("event", (e: MessageEvent) => {
        attempt = 0;
        try {
          const entry: EventEntry = JSON.parse(e.data);
          appendEvent(entry);
        } catch {
          // ignore malformed
        }
        setConnected(true);
      });

      es.addEventListener("sla_warning", (e: MessageEvent) => {
        try {
          const alert = JSON.parse(e.data);
          onSlaRef.current?.(alert);
          queryClient.invalidateQueries({ queryKey: ["orders-sla"] });
        } catch {
          // ignore
        }
      });

      // Some brokers send data without event type; handle as generic
      es.onmessage = (e: MessageEvent) => {
        try {
          const entry: EventEntry = JSON.parse(e.data);
          if (entry.eventName) appendEvent(entry);
        } catch {
          // ignore
        }
      };

      es.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (!active) return;
        const delay = Math.min(1_000 * 2 ** attempt, 30_000);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [sseUrl, appendEvent, queryClient]);

  const clear = useCallback(() => setEvents([]), []);

  return { events, connected, clear };
}
