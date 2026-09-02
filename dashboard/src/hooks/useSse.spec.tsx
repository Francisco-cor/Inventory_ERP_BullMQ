import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSse } from "./useSse.js";
import type { ReactNode } from "react";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useSse", () => {
  it("initializes disconnected then connected", async () => {
    const { result } = renderHook(() => useSse({ sseUrl: "/api/v1/obs/events/stream" }), {
      wrapper,
    });
    expect(result.current.connected).toBe(false);
    // After EventSource mock triggers onopen, should become true
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it("clears events", async () => {
    const { result } = renderHook(() => useSse({ sseUrl: "/api/stream" }), { wrapper });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.events).toEqual([]);
    result.current.clear();
    expect(result.current.events).toEqual([]);
  });
});
