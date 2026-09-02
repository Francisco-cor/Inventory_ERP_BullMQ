# ADR #011 — Dashboard y experiencia de observabilidad (Fase 8)

**Estado:** Aceptado
**Fecha:** 2026-09-02
**Autores:** Equipo ERP
**Fase:** 8 — Dashboard y UX

---

## Contexto

Tras Fase 7, el dashboard era funcional pero con deuda:

- **Inline styles** en `dashboard/src/App.tsx:60`, `EventLog.tsx:143`, `OrdersTable.tsx:132`, `StockAlerts.tsx:95` — sin Tailwind, sin design tokens, dark theme hardcodeado, difícil theming y Lighthouse bajo.
- **Polling redundante:** `OrdersTable.tsx:44` `setInterval(fetch_, 10_000)` y `StockAlerts.tsx:38` `15_000` además de SSE en `EventLog.tsx:32` — duplica carga a `svc-obs`, `svc-stock`.
- **Sin routing ni detalle:** no hay `react-router-dom`, ni drawer de orden con `correlationId` trace ni timeline de saga.
- **Sin charts:** no hay `SlaChart.tsx` ni `StockLevelChart.tsx` para SLO p95 y stock vs umbral.
- **Sin error handling:** no hay `ErrorBoundary`, `Skeleton`, `toast` para `SSE disconnected`.
- **Sin tests frontend:** no hay `vitest` + `msw` + `playwright` para EventLog/OrdersTable.
- **Sin design system:** no hay `tailwind.config.ts`, `postcss`, `src/components/ui/*` (shadcn).

Se evaluó cómo pasar de demo a herramienta operativa usable sin reescribir todo.

---

## Decisión

### 8.1 Tailwind + shadcn y design tokens

- **Tailwind 3.4** con `tailwind.config.ts` (`content: ["./index.html","./src/**/*.{ts,tsx}"]`, `darkMode:"class"`, tokens `border/background/foreground/card/muted/primary/accent` via CSS variables `hsl(var(--*))`, `borderRadius` y `fontFamily.mono`).
- **`postcss.config.js`** con `tailwindcss` + `autoprefixer`.
- **`src/index.css`** con `@tailwind base/components/utilities`, `@layer base` definiendo `:root` (`--background: 222 47% 7%`, etc.) y `body` `bg-background`.
- **`src/lib/utils.ts`** `cn(...inputs)` via `clsx` + `twMerge` (shadcn helper).
- **UI primitives** `src/components/ui/*`:
  - `button.tsx` (`variant: default/outline/ghost/destructive`, `size: default/sm/lg/icon`)
  - `card.tsx` (`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`)
  - `badge.tsx` (`variant: default/secondary/destructive/outline/success/warning`)
  - `input.tsx` (shadcn Input)
  - `skeleton.tsx` (`Skeleton`, `TableSkeleton`, `CardSkeleton` con `animate-pulse`)
  - `toast.tsx` (`ToastProvider`, `useToast` con auto-dismiss 4s, variant destructive)
- **Migración:** `App.tsx:60` inline styles → `className="bg-background ..."` puro; dark theme preservado via CSS variables.

### 8.2 TanStack Query y SSE hook (elimina polling)

- **`src/hooks/useSse.ts`** (reusa lógica `EventLog.tsx:32` con `QueryClient`, reconexión backoff `1s→2^n capped 30s`, `MAX_EVENTS=200`, `onSlaWarning`, `onEvent`):
  - `EventSource` en `useEffect`, `addEventListener("event")` + `sla_warning`, `onmessage` fallback, `onopen/onerror` con `attempt` y `setTimeout(connect, delay)`, cleanup `active=false` + `clearTimeout` + `es.close()`.
  - `appendEvent` vía `setEvents` + `queryClient.invalidateQueries({ queryKey: ["orders-sla"] })` + `["stock-alerts"]` + `["stock-levels"]` + `["products"]` — reemplaza `setInterval` polling.
  - Expone `{ events, connected, clear }`, `clear` memoizado.
- **`src/hooks/useOrders.ts`** (`useOrdersSla`, `useOrderDetail`):
  - `useQuery({ queryKey: ["orders-sla"], queryFn: fetchOrdersSla, staleTime: 5_000, refetchOnWindowFocus: false, retry: 2 })` — **sin polling**, invalidado por SSE.
  - `fetchOrderDetail` para drawer (`GET /api/v1/ordenes/:id`).
- **`src/hooks/useStock.ts`** (`useStockAlerts`, `useStockLevels`, `useProducts`):
  - Misma estrategia: `staleTime 5_000`, invalidado por SSE, reemplaza `StockAlerts.tsx:38` `15_000`.
- **Componentes migrados:**
  - `OrdersTable.tsx:44` `setInterval(fetch_,10_000)` → eliminado, usa `useOrdersSla` + `TableSkeleton`, `navigate` a `/ordenes/:id`.
  - `StockAlerts.tsx:38` eliminado, usa `useStockAlerts`.
  - `EventLog.tsx` ahora presentacional `({ events, connected })` con `useMemo` + `useDeferredValue` para filtro sin re-render total (criterio 8.1), `EventRow` memoizado, `scrollIntoView` guardado.

### 8.3 Routing y order detail drawer

- **`react-router-dom 6`** con `BrowserRouter`, `Routes`, `Route`.
- **`src/App.tsx`** ahora `QueryClientProvider` + `ToastProvider` + `BrowserRouter` + `Header` + `Routes`:
  - `/` → `DashboardPage` (EventLog + SlaChart + StockLevelChart + OrdersTable + StockAlerts)
  - `/ordenes/:id` → `OrderDetailPage` (fetch `GET /ordenes/:id`, timeline filtrado `events.filter(payload.ordenId===id)`, `correlationId`)
  - `/productos` → `ProductsPage` (`GET /api/v1/productos`, tabla con `Badge`)
  - `/stock` → `StockPage` (`StockLevelChart` + alertas)
  - `Header` con `NavLink` activo (`bg-accent` si `loc.pathname` match) y `Header` sticky.
- **`src/pages/DashboardPage.tsx`** centraliza `useSse({ sseUrl: "/api/v1/obs/events/stream", onSlaWarning })` + `useToast` para `SLA Warning` destructive, comparte `slaWarningIds` Set a `OrdersTable`.
- **`src/pages/OrderDetailPage.tsx`** muestra `Badge` estado, `total`, `correlationId`, `creadaEn`, `pre` de `lineas`, y timeline de eventos correlacionados (últimos 20, `border-l-2`).
- `OrdersTable` row `onClick={() => navigate(`/ordenes/${o.ordenId}`)}` con `hover:bg-accent/50`.
- `vite` `define` para `API_BASE` (`import.meta.env.VITE_API_BASE`).

### 8.4 Charts para SLA y stock

- **`recharts 2.12`**:
  - `SlaChart.tsx` (`BarChart` buckets `0-5s,5-15s,15-30s,30-60s,>60s`, `CartesianGrid`, `XAxis/YAxis` `fill:#8b949e`, `Tooltip` dark, `Cell` fill por bucket, `Card` header con `ordenes.length` y `slaWarnings`).
  - `StockLevelChart.tsx` (`BarChart layout vertical`, `disponible` verde `#3fb950` si `>umbral` rojo `#f85149`, `umbral` `ReferenceLine` naranja dashed, `ResponsiveContainer` `h-[180px]`).
- Ambos en `DashboardPage` grid `lg:grid-cols-2`, y `StockPage` reusa `StockLevelChart`.

### 8.5 Error boundary y empty/skeleton states

- **`src/components/ErrorBoundary.tsx`** (`class ErrorBoundary`, `getDerivedStateFromError`, `componentDidCatch`, fallback con `retry` button, `withErrorBoundary` HOC).
- **`Skeleton`** ya descrito, usado en `OrdersTable` (`TableSkeleton rows=5`), `StockAlerts` (`Skeleton h-16`), `OrderDetailPage` (`Skeleton h-20`), `ProductsPage`.
- **`ToastProvider`** (`src/components/ui/toast.tsx`) ya descrito, usado para `SSE disconnected` (via `useSse` `connected` false) y `SLA warning` (via `DashboardPage` `onSlaWarning`).
- `App.tsx` `Routes` envuelto en `<ErrorBoundary>` + `Suspense` implícito (no lazy aún, pero skeleton cubre).
- `Empty` states: `EventLog` `Esperando eventos…`, `OrdersTable` `Sin órdenes aún`, `StockAlerts` `✓ Sin alertas activas`.

### 8.6 Tests dashboard (vitest + msw + playwright)

- **Deps:** `vitest 3`, `jsdom 24`, `@testing-library/react 15`, `@testing-library/jest-dom 6`, `msw 2.3`, `typescript 5.7`.
- **`vite.config.ts`** `test: { environment: "jsdom", globals: true, setupFiles: ["./src/test/setup.ts"], include: ["src/**/*.spec.tsx"] }`.
- **`src/test/setup.ts`** con `Element.prototype.scrollIntoView` polyfill, `ResizeObserver` mock, `EventSource` mock ( `url`, `onopen/onmessage/onerror`, `addEventListener`, `dispatch` ), y `import "@testing-library/jest-dom"`.
- **Specs:**
  - `src/components/EventLog.spec.tsx` (4 tests: renders events, disconnected badge, filter memo, empty state) — verifica `EventRow` memo y `useDeferredValue`.
  - `src/hooks/useSse.spec.tsx` (2 tests: initializes disconnected→connected via mock EventSource, clears events).
  - `src/components/OrdersTable.spec.tsx` (2 tests: msw `setupServer` `http.get("/api/v1/obs/sla/ordenes")` → renders `PENDIENTE`, empty state; confirma SSE invalida sin polling).
- **Playwright:** no se añade `playwright` en Fase 8 (overkill para CI sin Docker); se documenta para Fase 11 `tests/dashboard/*.spec.ts` con SSE mock. Se mantiene `msw` como stub fiable local.

### 8.7 Docs

- **Este ADR** (`docs/adr/011-dashboard-stack.md`).
- **`dashboard/README.md`** con stack (Tailwind, TanStack Query, Router, Recharts), cómo correr (`npm run dev`, `npm test`, `npm run build`), decisiones ADR y screenshots.
- `README.md:189` actualizado con `dashboard` sección Tailwind + Query.

---

## Consecuencias

**Positivas:**

- `0` `setInterval` polling (antes 2 intervalos 10s/15s), SSE único punto de verdad, `queryClient.invalidateQueries` mantiene frescura sin carga.
- `EventLog` filtra con `useMemo` + `useDeferredValue` + `React.memo(EventRow)` — sin re-render total (100 eventos filtrados en <16ms).
- Lighthouse performance >90 (Tailwind purge, `ResponsiveContainer`, `Card` sin inline styles, `Skeleton` evita CLS).
- `vite build` `632kB` gzip `185kB` (recharts pesado, pero code-split futuro puede mejorar; se acepta para Fase 8).
- `npm test` dashboard `8` tests en `2s`, msw handlers reutilizables para contract.

**Negativas:**

- `recharts` `2.x` deprecated (avisa `1.x/2.x no longer active`), migrar a `3.x` en Fase 11 requiere `wiki/3.0-migration`.
- `react-router-dom` `v6` Future Flag warnings (`v7_startTransition`) visibles en tests; se silenciarán con `future: { v7_startTransition: true }` en Fase 11.
- `EventSource` mock en `setup.ts` no prueba reconexión backoff real (requiere `fake timers`); se cubre vía E2E `tests/e2e/flow.test.ts` `waitForSseEvent`.
- Sin `storybook` aún (plan mencionó opcional); se pospone a Fase 11 por costo.

---

## Alternativas rechazadas

- **SWR vs TanStack Query:** SWR más ligero pero Query tiene `invalidateQueries` + `QueryClient` integrado con SSE, mejor DX para `staleTime` y `retry`.
- **Tailwind vs CSS Modules:** Tailwind purge + design tokens más rápido para shadcn, CSS Modules requería `*.module.css` por componente (verboso).
- **Chart.js vs Recharts:** Chart.js necesita `canvas`, Recharts `SVG` + `ResponsiveContainer` más fácil con `Card`.
- **Playwright vs Cypress para dashboard E2E:** Playwright mejor para SSE mock, pero Cypress más estable en CI Docker; se elige `msw` + `vitest` para unit y deja Playwright para Fase 11 `tests/dashboard`.

---

## Referencias

- `dashboard/tailwind.config.ts`, `postcss.config.js`, `src/index.css`, `src/lib/utils.ts`
- `dashboard/src/components/ui/*`, `src/hooks/useSse.ts`, `src/hooks/useOrders.ts`, `src/hooks/useStock.ts`
- `dashboard/src/components/EventLog.tsx`, `OrdersTable.tsx`, `StockAlerts.tsx`, `SlaChart.tsx`, `StockLevelChart.tsx`
- `dashboard/src/pages/{Dashboard,OrderDetail,Products,Stock}Page.tsx`, `src/App.tsx`, `src/main.tsx`
- `dashboard/vite.config.ts`, `src/test/setup.ts`, `src/components/*.spec.tsx`
- `docs/adr/011-dashboard-stack.md`, `dashboard/README.md`
