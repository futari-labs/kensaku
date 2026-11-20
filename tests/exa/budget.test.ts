import { describe, expect, it } from "vitest";
import { RequestBudget } from "../../src/exa/budget";
import { ExaFailure } from "../../src/exa/errors";

describe("RequestBudget", () => {
  it("issues five tokens and refuses the sixth", () => {
    const budget = new RequestBudget(5);
    for (let i = 1; i <= 5; i++) {
      budget.take();
      expect(budget.used).toBe(i);
    }
    expect(() => budget.take()).toThrowError(ExaFailure);
    try {
      budget.take();
    } catch (e) {
      expect((e as ExaFailure).kind).toBe("budget_exhausted");
    }
    expect(budget.used).toBe(5);
  });

  it("cannot be built with a larger limit", () => {
    expect(() => new RequestBudget(6 as 5)).toThrow(RangeError);
  });

  it("keeps separate counts per run", () => {
    const a = new RequestBudget(5);
    const b = new RequestBudget(5);
    a.take();
    expect([a.used, b.used]).toEqual([1, 0]);
  });
});
