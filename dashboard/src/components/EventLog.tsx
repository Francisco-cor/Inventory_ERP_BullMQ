import { useEffect, useRef, useState } from "react";
import type { EventEntry } from "../types.js";

const EVENT_COLORS: Record<string, string> = {
  "orden.creada":      "#58a6ff",
  "orden.confirmada":  "#3fb950",
  "orden.cancelada":   "#f85149",
  "stock.reservado":   "#d2a8ff",
  "stock.insuficiente":"#ffa657",
  "stock.liberado":    "#79c0ff",
  "stock.alerta":      "#ffa657",
  "stock.ajustado":    "#a5d6ff",
  "producto.creado":   "#7ee787",
  "producto.actualizado":"#e3b341",
  "producto.eliminado":"#f85149",
};

const MAX_EVENTS = 200;

interface Props {
  sseUrl: string;
  onSlaWarning: (alert: { ordenId: string; creadaEn: string; segundosPendiente: number }) => void;
}

export function EventLog({ sseUrl, onSlaWarning }: Props) {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let active = true; // set to false on cleanup to cancel pending reconnects

    function connect() {
      if (!active) return;
      es = new EventSource(sseUrl);

      es.addEventListener("event", (e: MessageEvent) => {
        attempt = 0; // reset backoff on successful message
        const entry: EventEntry = JSON.parse(e.data);
        setEvents((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
        setConnected(true);
      });

      es.addEventListener("sla_warning", (e: MessageEvent) => {
        onSlaWarning(JSON.parse(e.data));
      });

      es.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (!active) return;
        // Exponential backoff: 1 s → 2 s → 4 s → … capped at 30 s
        const delay = Math.min(1_000 * 2 ** attempt, 30_000);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      active = false;
      reconnectTimer && clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [sseUrl, onSlaWarning]);

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events]);

  const filtered = filter
    ? events.filter(
        (e) =>
          e.eventName.includes(filter) ||
          e.source.includes(filter) ||
          e.correlationId.includes(filter)
      )
    : events;

  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          <span style={{ color: connected ? "#3fb950" : "#f85149", marginRight: 8 }}>●</span>
          Event Log
          <span style={styles.badge}>{events.length}</span>
        </h2>
        <input
          style={styles.filterInput}
          placeholder="Filtrar por nombre, servicio…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div
        style={styles.logContainer}
        onScroll={(e) => {
          const el = e.currentTarget;
          autoScroll.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
        }}
      >
        {filtered.length === 0 && (
          <p style={styles.empty}>Esperando eventos…</p>
        )}
        {filtered.map((ev) => (
          <div key={ev.eventId} style={styles.eventRow}>
            <span style={styles.timestamp}>
              {new Date(ev.timestamp).toLocaleTimeString()}
            </span>
            <span
              style={{
                ...styles.eventName,
                color: EVENT_COLORS[ev.eventName] ?? "#e6edf3",
              }}
            >
              {ev.eventName}
            </span>
            <span style={styles.source}>{ev.source}</span>
            <span style={styles.correlationId}>
              {ev.correlationId.slice(0, 8)}
            </span>
            <span style={styles.payload}>
              {JSON.stringify(ev.payload).slice(0, 80)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 8,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderBottom: "1px solid #30363d",
    background: "#0d1117",
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  badge: {
    background: "#21262d",
    borderRadius: 10,
    padding: "1px 8px",
    fontSize: 11,
    marginLeft: 8,
  },
  filterInput: {
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 6,
    color: "#e6edf3",
    padding: "4px 10px",
    fontSize: 12,
    flexGrow: 1,
    fontFamily: "inherit",
  },
  logContainer: {
    height: 380,
    overflowY: "auto",
    padding: "8px 0",
  },
  eventRow: {
    display: "grid",
    gridTemplateColumns: "80px 200px 120px 90px 1fr",
    gap: 8,
    padding: "3px 16px",
    fontSize: 12,
    borderBottom: "1px solid #21262d",
    lineHeight: 1.6,
  },
  timestamp: { color: "#6e7681" },
  eventName: { fontWeight: 600 },
  source:    { color: "#8b949e" },
  correlationId: { color: "#6e7681", fontFamily: "monospace" },
  payload: { color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  empty:   { color: "#6e7681", textAlign: "center", padding: 32, fontSize: 13 },
};
