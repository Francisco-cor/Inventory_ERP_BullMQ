import { describe, expect, it } from "vitest";
import { debeGenerarSlaWarning, segundosPendiente } from "./sla-policy.js";

const NOW = new Date("2026-09-21T12:00:00.000Z");

describe("SLA policy", () => {
  it("calculates elapsed seconds and never returns a negative duration", () => {
    expect(segundosPendiente("2026-09-21T11:58:30.000Z", NOW)).toBe(90);
    expect(segundosPendiente("2026-09-21T12:00:01.000Z", NOW)).toBe(0);
  });

  it("generates a warning at the configured threshold", () => {
    expect(debeGenerarSlaWarning("2026-09-21T11:59:00.000Z", 60, NOW)).toBe(true);
    expect(debeGenerarSlaWarning("2026-09-21T11:59:01.000Z", 60, NOW)).toBe(false);
  });

  it("rejects invalid dates and thresholds", () => {
    expect(() => segundosPendiente("not-a-date", NOW)).toThrow(RangeError);
    expect(() => debeGenerarSlaWarning(NOW, 0, NOW)).toThrow(RangeError);
  });
});
