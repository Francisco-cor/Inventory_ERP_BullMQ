import { describe, it, expect } from "vitest";
import {
  puedeTransicionar,
  describir,
  TransicionInvalidaError,
  ESTADOS_ORDEN,
} from "./orden.statemachine.js";

describe("orden.statemachine", () => {
  describe("puedeTransicionar", () => {
    it("pendiente → confirmada: válida", () => {
      expect(puedeTransicionar("pendiente", "confirmada")).toBe(true);
    });

    it("pendiente → cancelada: válida", () => {
      expect(puedeTransicionar("pendiente", "cancelada")).toBe(true);
    });

    it("confirmada → pendiente: inválida (terminal)", () => {
      expect(puedeTransicionar("confirmada", "pendiente")).toBe(false);
    });

    it("confirmada → cancelada: inválida", () => {
      expect(puedeTransicionar("confirmada", "cancelada")).toBe(false);
    });

    it("cancelada → confirmada: inválida", () => {
      expect(puedeTransicionar("cancelada", "confirmada")).toBe(false);
    });

    it("pendiente → pendiente: inválida (no self-transition)", () => {
      expect(puedeTransicionar("pendiente", "pendiente")).toBe(false);
    });

    it("todos los estados están en ESTADOS_ORDEN", () => {
      expect(ESTADOS_ORDEN).toEqual(["pendiente", "confirmada", "cancelada"]);
    });
  });

  describe("describir", () => {
    it("describe pendiente con transiciones", () => {
      const msg = describir("pendiente");
      expect(msg).toContain("pendiente");
      expect(msg).toContain("confirmada");
      expect(msg).toContain("cancelada");
    });

    it("describe confirmada como terminal", () => {
      expect(describir("confirmada")).toContain("terminal");
    });

    it("describe cancelada como terminal", () => {
      expect(describir("cancelada")).toContain("terminal");
    });
  });

  describe("TransicionInvalidaError", () => {
    it("mensaje incluye actual y siguiente para transición no-terminal", () => {
      const err = new TransicionInvalidaError("pendiente", "pendiente");
      expect(err.actual).toBe("pendiente");
      expect(err.siguiente).toBe("pendiente");
      expect(err.message).toContain("pendiente");
      expect(err.message).toContain("Transición inválida");
      expect(err.name).toBe("TransicionInvalidaError");
    });

    it("terminal no permite más transiciones", () => {
      const err = new TransicionInvalidaError("confirmada", "pendiente");
      expect(err.actual).toBe("confirmada");
      expect(err.message).toContain("terminal");
      expect(err.message).toContain("confirmada");
    });

    it("terminal cancelada", () => {
      const err = new TransicionInvalidaError("cancelada", "confirmada");
      expect(err.message).toContain("terminal");
      expect(err.message).toContain("cancelada");
    });
  });
});
