import { describe, expect, it } from "vitest";
import { classifyHit } from "../../src/core";
import { buildClassificationInput, readJson, type ClassificationFile } from "../core/fixtures";

// Frozen gold cases: evals/cases/offer-classification.json (read-only, every case evaluated).
const file = readJson<ClassificationFile>("evals/cases/offer-classification.json");

describe("EV-001 merchant authenticity", () => {
  it("evaluates every case in the frozen file", () => {
    expect(file.cases.length).toBe(54);
  });

  it.each(file.cases.map((c) => [c.id, c] as const))("%s matches its label", (_id, c) => {
    const { hit, candidate, runResultUrls } = buildClassificationInput(file, c);
    const result = classifyHit(hit, candidate, runResultUrls);
    const { expected } = c;
    expect(result.kind).toBe(expected.outcome);
    if (result.kind === "merchant-offer") {
      expect(result.price.currency).toBe(expected.currency);
      expect(result.price.amount).toBe(expected.amount);
      if (expected.canonicalUrl !== undefined) expect(result.canonicalUrl).toBe(expected.canonicalUrl);
      if (expected.availability !== undefined) expect(result.availability).toBe(expected.availability);
    } else {
      expect(result.category).toBe(expected.category);
    }
  });
});
