import { useEffect, useState, useCallback } from "react";

interface StockAlertItem {
  id: string;
  productoId: string;
  sku: string;
  disponible: number;
  umbral: number;
  resuelta: boolean;
  creadaEn: string;
}

interface Props {
  apiBase: string;
  refreshTick: number;
}

export function StockAlerts({ apiBase, refreshTick }: Props) {
  const [alerts, setAlerts] = useState<StockAlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/stock/alertas`);
      if (!res.ok) return;
      const json = await res.json();
      setAlerts(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetch_();
  }, [fetch_, refreshTick]);

  useEffect(() => {
    const t = setInterval(fetch_, 15_000);
    return () => clearInterval(t);
  }, [fetch_]);

  const active = alerts.filter((a) => !a.resuelta);

  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          {active.length > 0 && (
            <span style={styles.alertDot}>⚠</span>
          )}
          Alertas de Stock
        </h2>
        <span style={styles.count}>
          {active.length} activa{active.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div style={styles.body}>
        {loading ? (
          <p style={styles.empty}>Cargando…</p>
        ) : active.length === 0 ? (
          <p style={styles.empty}>✓ Sin alertas activas</p>
        ) : (
          active.map((a) => (
            <div key={a.id} style={styles.alertCard}>
              <div style={styles.alertHeader}>
                <span style={styles.sku}>{a.sku}</span>
                <span style={styles.disponible}>
                  {a.disponible} / {a.umbral} uds
                </span>
              </div>
              <div style={styles.alertMeta}>
                <code style={{ fontSize: 10, color: "#6e7681" }}>{a.productoId.slice(0, 13)}…</code>
                <span style={{ fontSize: 10, color: "#6e7681" }}>
                  {new Date(a.creadaEn).toLocaleTimeString()}
                </span>
              </div>
              <div style={styles.progressBar}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${Math.min(100, (a.disponible / a.umbral) * 100)}%`,
                    background: a.disponible === 0 ? "#f85149" : "#ffa657",
                  }}
                />
              </div>
            </div>
          ))
        )}
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
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid #30363d",
    background: "#0d1117",
  },
  title: { fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 },
  alertDot: { color: "#ffa657" },
  count: { marginLeft: "auto", fontSize: 11, color: "#6e7681" },
  body: { padding: 12, display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto" },
  alertCard: {
    background: "rgba(255,166,87,0.08)",
    border: "1px solid rgba(255,166,87,0.3)",
    borderRadius: 6,
    padding: 10,
  },
  alertHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sku: { fontWeight: 700, fontSize: 13, color: "#ffa657" },
  disponible: { fontSize: 11, color: "#e6edf3" },
  alertMeta: { display: "flex", justifyContent: "space-between", marginBottom: 6 },
  progressBar: {
    height: 3,
    background: "#21262d",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  empty: { color: "#6e7681", textAlign: "center", padding: 24, fontSize: 13 },
};
