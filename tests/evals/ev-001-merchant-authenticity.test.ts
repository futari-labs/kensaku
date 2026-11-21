import { describe, expect, it } from "vitest";
import { classifyHit } from "../../src/core";
import { buildClassificationInput, readJson, type ClassificationCase, type ClassificationFile } from "../core/fixtures";

// Frozen gold cases: evals/cases/offer-classification.json (read-only, every case evaluated). Under the v1.1 rules
// exactly two labels change (D-031, D-032); the frozen file records them in the `supersedes` block of
// evals/cases/offer-classification-v1-1.json, and only those two are replaced here.
const mvp = readJson<ClassificationFile>("evals/cases/offer-classification.json");
const { supersedes } = readJson<{ supersedes: Record<string, { expected: ClassificationCase["expected"] }> }>(
  "evals/cases/offer-classification-v1-1.json",
);
const replacedIds = mvp.cases.filter((c) => c.id in supersedes).map((c) => c.id);
const file: ClassificationFile = {
  ...mvp,
  cases: mvp.cases.map((c) => (c.id in supersedes ? { ...c, expected: supersedes[c.id]!.expected } : c)),
};

describe("EV-001 merchant authenticity", () => {
  it("evaluates every case in the frozen file", () => {
    expect(file.cases.length).toBe(54);
  });

  it("replaces exactly L29 and Y03 with the v1.1 labels", () => {
    expect(Object.keys(supersedes).sort()).toEqual(["L29", "Y03"]);
    expect(replacedIds.sort()).toEqual(["L29", "Y03"]);
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
