import { useState, useCallback, useRef } from "react";
import { EventLog } from "./components/EventLog.js";
import { OrdersTable } from "./components/OrdersTable.js";
import { StockAlerts } from "./components/StockAlerts.js";

// In production (Docker) the dashboard makes requests through the same nginx
// that also proxies svc-obs, so origin-relative paths work.
// In dev (Vite proxy), also origin-relative.
const API_BASE = "";
const SSE_URL  = "/api/v1/obs/events/stream";

export default function App() {
  const [slaWarningIds, setSlaWarningIds] = useState<Set<string>>(new Set());
  const [refreshTick, setRefreshTick] = useState(0);
  const tickRef = useRef(refreshTick);
  tickRef.current = refreshTick;

  const handleSlaWarning = useCallback(
    (alert: { ordenId: string; creadaEn: string; segundosPendiente: number }) => {
      setSlaWarningIds((prev) => new Set([...prev, alert.ordenId]));
      setRefreshTick((t) => t + 1);
    },
    []
  );

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>ERP Observability</h1>
          <p style={styles.subtitle}>Event bus · SLA monitor · Stock alerts</p>
        </div>
        <div style={styles.services}>
          {["productos", "ordenes", "stock", "obs"].map((svc) => (
            <span key={svc} style={styles.serviceTag}>svc-{svc}</span>
          ))}
        </div>
      </header>

      <main style={styles.main}>
        {/* Full-width event log */}
        <div style={styles.fullRow}>
          <EventLog sseUrl={SSE_URL} onSlaWarning={handleSlaWarning} />
        </div>

        {/* Two-column bottom row */}
        <div style={styles.twoCol}>
          <OrdersTable
            apiBase={API_BASE}
            slaWarningIds={slaWarningIds}
            refreshTick={refreshTick}
          />
          <StockAlerts apiBase={API_BASE} refreshTick={refreshTick} />
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 24px",
    borderBottom: "1px solid #30363d",
    background: "#0d1117",
  },
  title:    { fontSize: 18, fontWeight: 700, color: "#e6edf3" },
  subtitle: { fontSize: 12, color: "#6e7681", marginTop: 2 },
  services: { display: "flex", gap: 6 },
  serviceTag: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 11,
    color: "#8b949e",
    fontFamily: "monospace",
  },
  main: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: 16,
  },
  fullRow: {},
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 360px",
    gap: 16,
  },
};
