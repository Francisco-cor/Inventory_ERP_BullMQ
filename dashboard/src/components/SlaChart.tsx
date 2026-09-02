import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import type { OrdenSla } from "../types.js";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card.js";

const COLORS: Record<string, string> = {
  pendiente: "#e3b341",
  confirmada: "#3fb950",
  cancelada: "#f85149",
  sla_warning: "#ff6b6b",
};

export function SlaChart({ ordenes }: { ordenes: OrdenSla[] }) {
  // Histogram buckets: 0-5s, 5-15s, 15-30s, 30-60s, 60s+
  const buckets = [
    { label: "0-5s", min: 0, max: 5, count: 0, fill: "#3fb950" },
    { label: "5-15s", min: 5, max: 15, count: 0, fill: "#58a6ff" },
    { label: "15-30s", min: 15, max: 30, count: 0, fill: "#e3b341" },
    { label: "30-60s", min: 30, max: 60, count: 0, fill: "#ffa657" },
    { label: ">60s", min: 60, max: Infinity, count: 0, fill: "#f85149" },
  ];

  for (const o of ordenes) {
    const d = o.duracionSegundos ?? 0;
    const b = buckets.find((bk) => d >= bk.min && d < bk.max);
    if (b) b.count += 1;
  }

  const slaWarnings = ordenes.filter((o) => o.estadoSla === "sla_warning").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>SLA — Duración de órdenes</span>
          <span className="text-xs font-normal text-muted-foreground">
            {ordenes.length} órdenes · {slaWarnings} SLA warnings
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#8b949e" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#8b949e" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  fontSize: 11,
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {buckets.map((b, i) => (
                  <Cell key={i} fill={b.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex gap-2 text-[10px] text-muted-foreground">
          {Object.entries(COLORS).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: v }} /> {k}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
