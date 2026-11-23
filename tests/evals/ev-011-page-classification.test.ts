import { describe, expect, it } from "vitest";
import { classifyHit } from "../../src/core";
import { buildClassificationInput, readJson, type ClassificationFile } from "../core/fixtures";

// Frozen gold cases: evals/cases/offer-classification-v1-1.json (read-only, every case evaluated). Its cases
// reference candidates of the MVP file too.
const mvp = readJson<ClassificationFile>("evals/cases/offer-classification.json");
const v11 = readJson<ClassificationFile>("evals/cases/offer-classification-v1-1.json");
const file: ClassificationFile = { candidates: { ...mvp.candidates, ...v11.candidates }, cases: v11.cases };

describe("EV-011 page classification (v1.1)", () => {
  it("evaluates every case in the frozen file", () => {
    expect(file.cases.length).toBe(79);
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
