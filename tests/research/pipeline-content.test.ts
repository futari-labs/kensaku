// The pipeline's v1.1 output: card content, image candidates, and the cut comparison (D-042).
import { describe, expect, it } from "vitest";
import type { Candidate, ImageCandidate, ImageSource, SearchHit } from "../../src/core/types";
import type { AnswerResult, ExaPort, SearchResult } from "../../src/exa/port";
import type { RunEvent } from "../../src/research/events";
import { runResearch } from "../../src/research/pipeline";
import type { RunOptions } from "../../src/research/pipeline";

const xm5: Candidate = { name: "WH-1000XM5", brand: "Sony", modelIdentifiers: ["WH-1000XM5"] };

const answer = (candidates: Candidate[], comparison = "Good [1].\n\nNo cite here."): AnswerResult => ({
  comparison,
  candidates,
  citationUrls: ["https://review.example/a", "https://review.example/b"],
  exaRequestId: "a1",
  retrievedAt: "2026-11-21T10:00:00.000Z",
  costDollars: 0.005,
  cached: false,
});

const hit = (url: string, image?: string): SearchHit => ({
  url,
  title: "t",
  summary: { isProductListing: true, productName: "Sony WH-1000XM5", merchant: "Shop", price: 299, currency: "USD", availability: "in_stock" },
  exaRequestId: "s1",
  retrievedAt: "2026-11-21T10:00:01.000Z",
  ...(image !== undefined && { image }),
});

/** A port that replays one answer and one search. */
const port = (a: AnswerResult, hits: SearchHit[]): ExaPort => ({
  answerCandidates: async (_q, _m, budget) => (budget.take(), a),
  searchOffers: async (_c, _m, budget): Promise<SearchResult> => (
    budget.take(), { hits, exaRequestId: "s1", retrievedAt: "2026-11-21T10:00:01.000Z", costDollars: 0.015, cached: false }
  ),
});

async function run(p: ExaPort, options: RunOptions = {}): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const e of runResearch({ question: "q", market: "US" }, p, new AbortController().signal, options)) events.push(e);
  return events;
}

function productsOf(events: RunEvent[]) {
  const e = events.find((x) => x.type === "products");
  if (e?.type !== "products") throw new Error("no products event");
  return e.products;
}

function comparisonOf(events: RunEvent[]) {
  const e = events.find((x) => x.type === "comparison");
  if (e?.type !== "comparison") throw new Error("no comparison event");
  return e;
}

describe("runResearch product content and images", () => {
  it("attaches normalized keySpecs, the resolved reason and registered image candidates, and strips the raw fields from the candidate", async () => {
    const candidate: Candidate = { ...xm5, keySpecs: [" ANC ", "ANC", "", "30 h battery"], reason: "Great for travel [1]. {leak [9]}" };
    const registered: ImageSource[][] = [];
    const registerImages = (sources: ImageSource[]): ImageCandidate[] => {
      registered.push(sources);
      return sources.map((s, i) => ({ id: `id-${i}`, sourceHost: "shop.example", sourceTitle: s.sourceTitle }));
    };
    const events = await run(port(answer([candidate]), [hit("https://shop.example/a", "https://img.example/a.jpg"), hit("https://shop.example/b")]), { registerImages });
    const [product] = productsOf(events);
    expect(product!.candidate).toEqual(xm5);
    expect(product!.keySpecs).toEqual(["ANC", "30 h battery"]);
    expect(product!.reason).toMatchObject({ renderedText: "Great for travel [1].", sources: ["https://review.example/a"], citedSources: [{ url: "https://review.example/a", numbers: [1] }], truncated: true });
    expect(registered).toEqual([[{ imageUrl: "https://img.example/a.jpg", pageUrl: "https://shop.example/a", sourceTitle: "Sony WH-1000XM5" }]]);
    expect(product!.imageCandidates).toEqual([{ id: "id-0", sourceHost: "shop.example", sourceTitle: "Sony WH-1000XM5" }]);
  });

  it("gives a candidate without keySpecs or reason (an MVP answer) empty content, and registers nothing without images", async () => {
    const registered: ImageSource[][] = [];
    const events = await run(port(answer([xm5]), [hit("https://shop.example/a")]), { registerImages: (s) => (registered.push(s), []) });
    expect(productsOf(events)[0]).toMatchObject({ keySpecs: [], reason: null, imageCandidates: [] });
    expect(registered).toEqual([[]]);
  });

  it("cuts the comparison at leaked structure before resolving citations (D-042)", async () => {
    const leaky = answer([xm5], "Good [1].\n\nMore [2]. }}} ,top_results:[1]");
    const events = await run(port(leaky, [hit("https://shop.example/a")]));
    expect(comparisonOf(events)).toMatchObject({ text: "Good [1].\n\nMore [2].", truncated: true, sources: [{ url: "https://review.example/a" }, { url: "https://review.example/b" }] });

    const early = comparisonOf(await run(port(answer([xm5], "Good [1]. {junk [2]}"), [hit("https://shop.example/a")])));
    expect(early).toMatchObject({ text: "Good [1].", truncated: true });
    expect(early.sources.map((s) => s.url)).toEqual(["https://review.example/a"]);
  });

  it("has no text, marked truncated, when nothing readable is left, and a clean comparison is not truncated", async () => {
    const empty = comparisonOf(await run(port(answer([xm5], "{comparison: [1]}"), [hit("https://shop.example/a")])));
    expect(empty).toEqual({ type: "comparison", text: null, truncated: true, sources: [] });
    const clean = comparisonOf(await run(port(answer([xm5]), [hit("https://shop.example/a")])));
    expect(clean).toMatchObject({ text: "Good [1].\n\nNo cite here.", truncated: false });
  });
});
