import { describe, expect, it } from "vitest";
import { CircuitBreaker, CircuitOpenError, isInfrastructureFailure } from "@erp/resilience";

describe("database breaker failure policy", () => {
  it("counts connection failures but ignores domain SQL errors", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      failurePredicate: isInfrastructureFailure,
    });

    await expect(
      breaker.exec(async () => {
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      })
    ).rejects.toThrow("duplicate key");
    await expect(
      breaker.exec(async () => {
        throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      })
    ).rejects.toThrow("connection refused");
    await expect(
      breaker.exec(async () => {
        throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      })
    ).rejects.toThrow("connection refused");
    await expect(breaker.exec(async () => Promise.resolve())).rejects.toThrow(CircuitOpenError);

    expect(breaker.getState()).toBe("open");
  });
});
