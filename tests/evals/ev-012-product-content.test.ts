import { describe, expect, it } from "vitest";
import { cutLeakedStructure, normalizeKeySpecs, resolveCitations, resolveReason } from "../../src/core";
import type { ResolvedCitations } from "../../src/core";
import { loadLiveFixture, readJson } from "../core/fixtures";

// Frozen gold cases: evals/cases/product-content.json (read-only, every case evaluated).
interface ExpectedText {
  renderedText: string;
  sources: string[];
  unresolvedMarkers: number;
  uncitedParagraphs: number;
  truncated: boolean;
}
interface ContentCase {
  id: string;
  fixture?: string;
  synthetic?: { citations: string[]; candidates: Record<string, unknown>[] };
  candidates: { candidateIndex: number; expected: { keySpecs: string[]; reason: ExpectedText | null } }[];
}
interface ComparisonCase {
  id: string;
  fixture: string;
  expected: ExpectedText;
}
const file = readJson<{ cases: ContentCase[]; comparisonCases: ComparisonCase[] }>("evals/cases/product-content.json");

function answerOf(fixture: string) {
  const { response } = loadLiveFixture(fixture);
  // Some frozen answers (A1) predate the structured schema and are the comparison text itself.
  const answer = response.answer as string | { comparison: string; candidates: Record<string, unknown>[] };
  return {
    comparison: typeof answer === "string" ? answer : answer.comparison,
    candidates: typeof answer === "string" ? [] : answer.candidates,
    citations: (response.citations ?? []).map((c) => c.url),
  };
}

function inputOf(c: ContentCase) {
  if (c.synthetic) return c.synthetic;
  const { candidates, citations } = answerOf(c.fixture!);
  return { candidates, citations };
}

function expectText(actual: ResolvedCitations, truncated: boolean, expected: ExpectedText) {
  expect(actual.renderedText).toBe(expected.renderedText);
  expect(actual.sources).toEqual(expected.sources);
  expect(actual.unresolvedMarkers).toBe(expected.unresolvedMarkers);
  expect(actual.uncitedParagraphs.length).toBe(expected.uncitedParagraphs);
  expect(truncated).toBe(expected.truncated);
}

const candidateCases = file.cases.flatMap((c) => c.candidates.map((cand) => [`${c.id}#${cand.candidateIndex}`, c, cand] as const));

describe("EV-012 product content", () => {
  it("evaluates every case in the frozen file", () => {
    expect(file.cases.length).toBe(6);
    expect(file.comparisonCases.length).toBe(6);
    expect(candidateCases.length).toBe(file.cases.reduce((n, c) => n + c.candidates.length, 0));
  });

  it.each(candidateCases)("%s keySpecs and reason match", (_id, c, cand) => {
    const { candidates, citations } = inputOf(c);
    const raw = candidates[cand.candidateIndex]!;
    expect(normalizeKeySpecs(raw.keySpecs)).toEqual(cand.expected.keySpecs);
    const reason = resolveReason(raw.reason, citations);
    if (cand.expected.reason === null) expect(reason).toBeNull();
    else {
      expect(reason).not.toBeNull();
      expectText(reason!, reason!.truncated, cand.expected.reason);
    }
  });

  it.each(file.comparisonCases.map((c) => [c.id, c] as const))("%s comparison is cut, then resolved", (_id, c) => {
    const { comparison, citations } = answerOf(c.fixture);
    const cut = cutLeakedStructure(comparison);
    expect(cut).not.toBeNull();
    expectText(resolveCitations(cut!.text, citations), cut!.truncated, c.expected);
  });
});
