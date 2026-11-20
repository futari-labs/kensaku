import { describe, expect, it } from "vitest";
import { classifyHit, matchesIdentity } from "../../src/core";
import { buildClassificationInput, readJson, type ClassificationFile } from "../core/fixtures";

// Frozen gold cases: evals/cases/offer-classification.json (read-only, every case evaluated).
const file = readJson<ClassificationFile>("evals/cases/offer-classification.json");

describe("EV-002 product relevance", () => {
  it("evaluates every case in the frozen file", () => {
    expect(file.cases.length).toBe(54);
  });

  it.each(file.cases.map((c) => [c.id, c] as const))(
    "%s is irrelevant-product exactly when labeled",
    (_id, c) => {
      const { hit, candidate, runResultUrls } = buildClassificationInput(file, c);
      const labeledIrrelevant = c.expected.outcome === "rejected" && c.expected.category === "irrelevant-product";
      const result = classifyHit(hit, candidate, runResultUrls);
      expect(result.kind === "rejected" && result.category === "irrelevant-product").toBe(labeledIrrelevant);
      const identityText = hit.summary?.productName?.trim() ? hit.summary.productName : (hit.title ?? "");
      expect(matchesIdentity(identityText, candidate)).toBe(!labeledIrrelevant);
    },
  );
});
