import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardPage } from "./pages/DashboardPage.js";
import { OrderDetailPage } from "./pages/OrderDetailPage.js";
import { ProductsPage } from "./pages/ProductsPage.js";
import { StockPage } from "./pages/StockPage.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ToastProvider } from "./components/ui/toast.js";
import { cn } from "./lib/utils.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const loc = useLocation();
  const active = loc.pathname === to || (to !== "/" && loc.pathname.startsWith(to));
  return (
    <Link
      to={to}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-[#0d1117] px-4 py-3">
      <div className="flex items-center gap-6">
        <Link to="/" className="flex flex-col">
          <h1 className="text-sm font-bold tracking-tight text-foreground">ERP Observability</h1>
          <p className="text-[11px] text-muted-foreground">
            Event bus · SLA monitor · Stock alerts
          </p>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/productos">Productos</NavLink>
          <NavLink to="/stock">Stock</NavLink>
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden text-[11px] text-muted-foreground md:inline">
          React Query + SSE · sin polling
        </span>
        <div className="flex gap-1">
          {["productos", "ordenes", "stock", "obs"].map((svc) => (
            <span
              key={svc}
              className="rounded border bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              svc-{svc}
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

function AppRoutes() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="flex-1">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/ordenes/:id" element={<OrderDetailPage />} />
            <Route path="/productos" element={<ProductsPage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route
              path="*"
              element={
                <div className="p-8 text-center text-sm text-muted-foreground">
                  404 — No encontrado
                </div>
              }
            />
          </Routes>
        </ErrorBoundary>
      </main>
      <footer className="border-t px-4 py-2 text-center text-[10px] text-muted-foreground">
        Inventory ERP BullMQ · Dashboard v2 · TanStack Query + Tailwind + Recharts
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
