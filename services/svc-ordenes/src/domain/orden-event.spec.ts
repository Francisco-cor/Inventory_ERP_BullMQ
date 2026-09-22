import { describe, expect, it } from "vitest";
import { toEventTimestamp } from "./orden-event.js";

describe("toEventTimestamp", () => {
  it("serializa fechas PostgreSQL como ISO-8601", () => {
    expect(toEventTimestamp(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05.000Z");
  });

  it("preserva y normaliza timestamps string", () => {
    expect(toEventTimestamp("2026-01-02T03:04:05-06:00")).toBe("2026-01-02T09:04:05.000Z");
  });
});
