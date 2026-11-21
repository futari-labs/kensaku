import { describe, expect, it } from "vitest";
import { canonicalizeUrl, resolveCitations } from "../../src/core";
import { FixtureExaPort } from "../../src/exa/fixture-port";
import { runResearch } from "../../src/research/pipeline";
import type { RunEvent } from "../../src/research/events";
import { loadLiveFixture, readJson } from "../core/fixtures";

// Frozen gold cases: evals/cases/citations.json and evals/cases/citations-spaced.json (CR-001), read-only, every case evaluated.
interface CitationCase {
  id: string;
  fixture?: string;
  answerPath?: string;
  synthetic?: { text: string; citations: string[] };
  expected: { unresolvedMarkers: number; uncitedParagraphs: number; resolvedUrlCount: number; renderedText?: string };
}
const FILES = [
  { path: "evals/cases/citations.json", count: 6 },
  { path: "evals/cases/citations-spaced.json", count: 2 },
].map(({ path, count }) => ({ path, count, cases: readJson<{ cases: CitationCase[] }>(path).cases }));

function inputFor(c: CitationCase): { text: string; citations: string[] } {
  if (c.synthetic) return c.synthetic;
  const { response } = loadLiveFixture(c.fixture!);
  let node: unknown = { answer: response.answer };
  for (const key of c.answerPath!.split(".")) node = (node as Record<string, unknown>)[key];
  if (typeof node !== "string") throw new Error(`${c.id}: ${c.answerPath} is not text`);
  return { text: node, citations: (response.citations ?? []).map((x) => x.url) };
}

describe.each(FILES)("EV-004 citation cases: $path", ({ cases, count }) => {
  it("evaluates every case in the frozen file", () => {
    expect(cases.length).toBe(count);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s matches its label", (_id, c) => {
    const { text, citations } = inputFor(c);
    const result = resolveCitations(text, citations);
    expect(result.unresolvedMarkers).toBe(c.expected.unresolvedMarkers);
    expect(result.uncitedParagraphs.length).toBe(c.expected.uncitedParagraphs);
    expect(result.sources.length).toBe(c.expected.resolvedUrlCount);
    if (c.expected.renderedText !== undefined) expect(result.renderedText).toBe(c.expected.renderedText);
    for (const source of result.sources) expect(citations).toContain(source);
  });
});

// Fixture pipeline runs: what the UI would render must come from this run's Exa responses.
const RUNS = [
  { scenario: "xm5-us", market: "US", search: "S1-headphones" },
  { scenario: "xm5-sg", market: "SG", search: "S8-market-sg" },
  { scenario: "xm5-jp", market: "JP", search: "S9-market-jp" },
] as const;

describe("EV-004 fixture pipeline runs", () => {
  it.each(RUNS)("$scenario: every rendered source is a run citation and every offer URL is a run search result", async ({ scenario, market, search }) => {
    const answer = loadLiveFixture("A1-answer").response;
    const citations = (answer.citations ?? []).map((x) => x.url);
    const searchResponse = loadLiveFixture(search).response as unknown as { results: { url: string }[] };
    const resultUrls = new Set(searchResponse.results.map((r) => r.url));

    const events: RunEvent[] = [];
    for await (const e of runResearch({ question: "q", market }, FixtureExaPort.load(scenario), new AbortController().signal)) events.push(e);

    const comparison = events.find((e) => e.type === "comparison");
    const products = events.find((e) => e.type === "products");
    if (comparison?.type !== "comparison" || products?.type !== "products") throw new Error("run did not complete");
    expect(comparison.sources.length).toBeGreaterThan(0);
    for (const source of comparison.sources) expect(citations).toContain(source.url);

    const offers = products.products.flatMap((p) => p.offerGroups.flatMap((g) => g.offers));
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      const fromRun = [...resultUrls].some((url) => canonicalizeUrl(url) === offer.canonicalUrl);
      expect(fromRun, offer.canonicalUrl).toBe(true);
    }
  });
});
