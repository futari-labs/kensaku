import { describe, expect, it } from "vitest";
import { resolveCitations } from "../../src/core";
import { loadLiveFixture, readJson } from "../core/fixtures";

// Frozen gold cases: evals/cases/citations.json (read-only, every case evaluated).
interface CitationCase {
  id: string;
  fixture?: string;
  answerPath?: string;
  synthetic?: { text: string; citations: string[] };
  expected: { unresolvedMarkers: number; uncitedParagraphs: number; resolvedUrlCount: number; renderedText?: string };
}
const file = readJson<{ cases: CitationCase[] }>("evals/cases/citations.json");

function inputFor(c: CitationCase): { text: string; citations: string[] } {
  if (c.synthetic) return c.synthetic;
  const { response } = loadLiveFixture(c.fixture!);
  let node: unknown = { answer: response.answer };
  for (const key of c.answerPath!.split(".")) node = (node as Record<string, unknown>)[key];
  if (typeof node !== "string") throw new Error(`${c.id}: ${c.answerPath} is not text`);
  return { text: node, citations: (response.citations ?? []).map((x) => x.url) };
}

describe("EV-004 citation cases", () => {
  it("evaluates every case in the frozen file", () => {
    expect(file.cases.length).toBe(6);
  });

  it.each(file.cases.map((c) => [c.id, c] as const))("%s matches its label", (_id, c) => {
    const { text, citations } = inputFor(c);
    const result = resolveCitations(text, citations);
    expect(result.unresolvedMarkers).toBe(c.expected.unresolvedMarkers);
    expect(result.uncitedParagraphs.length).toBe(c.expected.uncitedParagraphs);
    expect(result.sources.length).toBe(c.expected.resolvedUrlCount);
    if (c.expected.renderedText !== undefined) expect(result.renderedText).toBe(c.expected.renderedText);
    for (const source of result.sources) expect(citations).toContain(source);
  });
});
