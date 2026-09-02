import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { OrdersTable } from "./OrdersTable.js";

const server = setupServer(
  http.get("/api/v1/obs/sla/ordenes", () => {
    return HttpResponse.json({
      data: [
        {
          ordenId: "11111111-1111-1111-1111-111111111111",
          creadaEn: new Date().toISOString(),
          resueltaEn: null,
          estadoSla: "pendiente",
          duracionSegundos: 12,
        },
      ],
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("OrdersTable", () => {
  it("fetches and renders ordenes without polling (SSE invalidates)", async () => {
    render(<OrdersTable apiBase="" />, { wrapper });
    expect(screen.getByText("Órdenes — SLA")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/11111111/)).toBeInTheDocument());
    expect(screen.getByText("PENDIENTE")).toBeInTheDocument();
  });

  it("shows empty state when no orders", async () => {
    server.use(http.get("/api/v1/obs/sla/ordenes", () => HttpResponse.json({ data: [] })));
    render(<OrdersTable apiBase="" />, { wrapper });
    await waitFor(() => expect(screen.getByText("Sin órdenes aún")).toBeInTheDocument());
  });
});
