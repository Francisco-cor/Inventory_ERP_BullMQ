import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card.js";
import type { StockAlertItem } from "../hooks/useStock.js";

export function StockLevelChart({ alerts }: { alerts: StockAlertItem[] }) {
  const data = alerts.slice(0, 10).map((a) => ({
    sku: a.sku.slice(0, 10),
    disponible: a.disponible,
    umbral: a.umbral,
    low: a.disponible <= a.umbral,
  }));

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stock — Disponible vs Umbral</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de stock</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Stock — Disponible vs Umbral</span>
          <span className="text-xs font-normal text-muted-foreground">
            {data.length} SKUs con alertas
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "#8b949e" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                dataKey="sku"
                type="category"
                tick={{ fontSize: 10, fill: "#e6edf3" }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                contentStyle={{
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  fontSize: 11,
                }}
                formatter={(value: number, name: string) => [
                  value,
                  name === "disponible" ? "Disponible" : "Umbral",
                ]}
              />
              <Bar dataKey="disponible" radius={[0, 4, 4, 0]} barSize={10}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.low ? "#f85149" : "#3fb950"} />
                ))}
              </Bar>
              {/* Umbral as reference dashed line per item is not trivial; show avg */}
              <ReferenceLine x={data[0]?.umbral ?? 10} stroke="#ffa657" strokeDasharray="4 4" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Verde: stock ok · Rojo: por debajo del umbral · Línea naranja: umbral
        </p>
      </CardContent>
    </Card>
  );
}
