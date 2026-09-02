import { useProducts } from "../hooks/useStock.js";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card.js";
import { TableSkeleton } from "../components/ui/skeleton.js";
import { Badge } from "../components/ui/badge.js";

const API_BASE = "";

export function ProductsPage() {
  const { data: products = [], isLoading, error } = useProducts(API_BASE);

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <CardTitle>Productos · {products.length}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton rows={6} />
          ) : error ? (
            <p className="p-4 text-sm text-red-400">{(error as Error).message}</p>
          ) : products.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Sin productos</p>
          ) : (
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b">
                    {["SKU", "Nombre", "Precio", "Unidad"].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p: Record<string, unknown>) => (
                    <tr key={String(p.id)} className="border-b hover:bg-accent/30">
                      <td className="px-4 py-2 text-xs font-mono">{String(p.sku)}</td>
                      <td className="px-4 py-2 text-xs">{String(p.nombre)}</td>
                      <td className="px-4 py-2 text-xs">${String(p.precio)}</td>
                      <td className="px-4 py-2">
                        <Badge variant="secondary">{String(p.unidad)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
