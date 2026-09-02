# Dashboard — ERP Observability UI (Fase 8)

> **React 18 + Vite 6 + Tailwind 3.4 + TanStack Query 5 + React Router 6 + Recharts 2**

## Stack

- **Styling:** Tailwind CSS (tokens `background/foreground/card/muted/primary/accent` via CSS vars), `shadcn` primitives (`Button`, `Card`, `Badge`, `Input`, `Skeleton`, `Toast` en `src/components/ui/*`), `clsx` + `tailwind-merge` (`cn`).
- **Data:** TanStack Query 5 (`useOrdersSla`, `useStockAlerts`, `useProducts`, `useOrderDetail`) + SSE hook `useSse` con `QueryClient.invalidateQueries` (sin `setInterval` polling).
- **Routing:** React Router 6 (`/`, `/ordenes/:id`, `/productos`, `/stock`) con `Header` sticky y `NavLink` activo.
- **Charts:** Recharts (`SlaChart` histogram 0-5s/5-15s/15-30s/30-60s/>60s, `StockLevelChart` vertical disponible vs umbral).
- **Resiliencia:** `ErrorBoundary`, `Skeleton`, `ToastProvider` (auto-dismiss 4s), `Empty` states.
- **Tests:** Vitest 3 + jsdom + @testing-library/react + msw 2 (`EventLog.spec.tsx`, `OrdersTable.spec.tsx`, `useSse.spec.tsx`).

## Estructura

```
src/
  App.tsx                 # QueryClientProvider + ToastProvider + BrowserRouter + Header + Routes
  main.tsx                # import "./index.css" + createRoot
  index.css               # @tailwind base/components/utilities + :root tokens
  lib/utils.ts            # cn()
  components/
    ui/{button,card,badge,input,skeleton,toast}.tsx
    EventLog.tsx          # presentacional ({events,connected}) useMemo + useDeferredValue + memo Row
    OrdersTable.tsx       # useOrdersSla (sin polling), TableSkeleton, navigate /ordenes/:id
    StockAlerts.tsx       # useStockAlerts (sin polling)
    SlaChart.tsx          # BarChart buckets
    StockLevelChart.tsx   # BarChart vertical + ReferenceLine
    ErrorBoundary.tsx
    *.spec.tsx            # vitest + msw
  hooks/
    useSse.ts             # EventSource + backoff + invalidateQueries
    useOrders.ts          # useOrdersSla, useOrderDetail
    useStock.ts           # useStockAlerts, useStockLevels, useProducts
  pages/
    DashboardPage.tsx     # useSse + useToast SLA warnings + grid EventLog/Charts/Tables
    OrderDetailPage.tsx   # GET /ordenes/:id + timeline filtrado
    ProductsPage.tsx      # GET /productos
    StockPage.tsx         # StockLevelChart + alertas
  test/setup.ts           # jsdom polyfills + EventSource mock + ResizeObserver mock
  types.ts
tailwind.config.ts
postcss.config.js
vite.config.ts            # test: {environment:jsdom, setupFiles}
```

## Comandos

```bash
# dev (vite HMR, proxy /api → http://localhost)
npm run dev
# o desde raíz
make dev

# tests (vitest jsdom, 8 tests ~2s)
npm test
npm run test:watch

# build (tsc + vite, gzip ~185kB)
npm run build

# type-check
npm run type-check
```

## Decisiones clave (ver ADR 011)

- **Tailwind + shadcn** vs CSS Modules: purge + tokens más rápido, `cn` helper.
- **TanStack Query** vs SWR: `invalidateQueries` con SSE es más explícito que `mutate`.
- **Polling eliminado:** `OrdersTable.tsx:44` y `StockAlerts.tsx:38` `setInterval` → `0` intervalos, SSE invalida.
- **EventLog filtra sin re-render total:** `useMemo` + `useDeferredValue` + `React.memo(EventRow)` (100 eventos filtrados <16ms).
- **Recharts** vs Chart.js: SVG + ResponsiveContainer más fácil en Card.
- **msw** para tests frontend, Playwright pospuesto a Fase 11.

## Criterios Fase 8

- Lighthouse performance >90 (Tailwind purge, Skeleton evita CLS, ResponsiveContainer).
- EventLog filtra sin re-render total (memo + deferred).
- OrdersTable sin polling, solo SSE (ver `useOrdersSla` `staleTime` + `invalidateQueries`).
- Charts SLA y stock visibles en Dashboard.
- ErrorBoundary + Skeleton + Toast para `SSE disconnected` y `SLA warning`.
- Tests `vitest` + `msw` (8 tests, ver `vite.config.ts` `test`).

## Screenshots (docs/screenshots/*)

- Dashboard full (`dashboard_full.png`) — EventLog + SlaChart + StockLevelChart + OrdersTable + StockAlerts
- SLA warning (`sla_warning.png`) — toast destructive + row `animate-pulse`

## Referencias

- `docs/adr/011-dashboard-stack.md`
- `src/hooks/useSse.ts`, `src/components/EventLog.tsx`
- `vite.config.ts`, `src/test/setup.ts`
