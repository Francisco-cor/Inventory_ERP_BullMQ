import { useEffect, useState, useCallback } from "react";
import type { OrdenSla } from "../types.js";

const ESTADO_COLOR: Record<string, string> = {
  pendiente:   "#e3b341",
  confirmada:  "#3fb950",
  cancelada:   "#f85149",
  sla_warning: "#ff6b6b",
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente:   "PENDIENTE",
  confirmada:  "CONFIRMADA",
  cancelada:   "CANCELADA",
  sla_warning: "⚠ SLA WARNING",
};

interface Props {
  apiBase: string;
  slaWarningIds: Set<string>;
  refreshTick: number;
}

export function OrdersTable({ apiBase, slaWarningIds, refreshTick }: Props) {
  const [ordenes, setOrdenes] = useState<OrdenSla[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/obs/sla/ordenes`);
      if (!res.ok) return;
      const json = await res.json();
      setOrdenes(json.data);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetch_();
  }, [fetch_, refreshTick]);

  // Auto-refresh every 10s
  useEffect(() => {
    const t = setInterval(fetch_, 10_000);
    return () => clearInterval(t);
  }, [fetch_]);

  const displayed = [...ordenes].map((o) => ({
    ...o,
    estadoSla:
      slaWarningIds.has(o.ordenId) && o.estadoSla === "pendiente"
        ? ("sla_warning" as const)
        : o.estadoSla,
  }));

  return (
    <section style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.title}>Órdenes — SLA</h2>
        <span style={styles.subtitle}>últimas 100</span>
      </div>

      <div style={styles.tableWrapper}>
        {loading ? (
          <p style={styles.empty}>Cargando…</p>
        ) : displayed.length === 0 ? (
          <p style={styles.empty}>Sin órdenes aún</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                {["Orden ID", "Estado", "Creada", "Duración"].map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((o) => {
                const isSla = o.estadoSla === "sla_warning";
                return (
                  <tr
                    key={o.ordenId}
                    style={{
                      ...styles.tr,
                      background: isSla ? "rgba(248,81,73,0.08)" : undefined,
                    }}
                  >
                    <td style={styles.td}>
                      <code style={{ fontSize: 11 }}>{o.ordenId.slice(0, 13)}…</code>
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.estadoBadge,
                          color: ESTADO_COLOR[o.estadoSla] ?? "#e6edf3",
                          border: `1px solid ${ESTADO_COLOR[o.estadoSla] ?? "#30363d"}`,
                          animation: isSla ? "pulse 1.5s ease-in-out infinite" : undefined,
                        }}
                      >
                        {ESTADO_LABEL[o.estadoSla] ?? o.estadoSla}
                      </span>
                    </td>
                    <td style={{ ...styles.td, color: "#8b949e", fontSize: 11 }}>
                      {new Date(o.creadaEn).toLocaleTimeString()}
                    </td>
                    <td style={{ ...styles.td, color: isSla ? "#ff6b6b" : "#8b949e", fontSize: 11 }}>
                      {o.duracionSegundos}s
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
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
    alignItems: "baseline",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid #30363d",
    background: "#0d1117",
  },
  title:    { fontSize: 14, fontWeight: 600 },
  subtitle: { fontSize: 11, color: "#6e7681" },
  tableWrapper: { overflowY: "auto", maxHeight: 340 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    fontSize: 11,
    color: "#6e7681",
    padding: "6px 16px",
    borderBottom: "1px solid #21262d",
    position: "sticky" as const,
    top: 0,
    background: "#161b22",
  },
  tr: { borderBottom: "1px solid #21262d" },
  td: { padding: "8px 16px", fontSize: 12, verticalAlign: "middle" },
  estadoBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 10,
    letterSpacing: "0.05em",
  },
  empty: { color: "#6e7681", textAlign: "center", padding: 32, fontSize: 13 },
};
