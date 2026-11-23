// (v1.2) The validate stage gives every merchant offer its id and registers the offers (D-048).
import { describe, expect, it } from "vitest";
import { offerId } from "../../src/core";
import type { Candidate, Market, Offer, SearchHit } from "../../src/core/types";
import type { AnswerResult, ExaPort } from "../../src/exa/port";
import type { RunEvent } from "../../src/research/events";
import { runResearch } from "../../src/research/pipeline";

const xm5: Candidate = { name: "WH-1000XM5", brand: "Sony", modelIdentifiers: ["WH-1000XM5"] };
const answer: AnswerResult = {
  comparison: "Good [1].",
  candidates: [xm5],
  citationUrls: ["https://review.example/a"],
  exaRequestId: "a1",
  retrievedAt: "2026-11-21T10:00:00.000Z",
  costDollars: 0.005,
  cached: false,
};
const hit = (url: string, price: number, currency: string): SearchHit => ({
  url,
  title: "t",
  summary: { isProductListing: true, productName: "Sony WH-1000XM5", merchant: "Shop", price, currency, availability: "in_stock" },
  exaRequestId: "s1",
  retrievedAt: "2026-11-21T10:00:01.000Z",
});
const port = (hits: SearchHit[]): ExaPort => ({
  answerCandidates: async (_q, _m, budget) => (budget.take(), answer),
  searchOffers: async (_c, _m, budget) => (budget.take(), { hits, exaRequestId: "s1", retrievedAt: "2026-11-21T10:00:01.000Z", costDollars: 0.015, cached: false }),
});

async function run(p: ExaPort, registerOffers?: (offers: Offer[], market: Market) => void): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const e of runResearch({ question: "q", market: "US" }, p, new AbortController().signal, { ...(registerOffers && { registerOffers }) })) events.push(e);
  return events;
}

describe("runResearch offer ids and registration", () => {
  it("assigns the EV-018 offerId to every merchant offer, in every currency group, and registers exactly those offers for the run's market", async () => {
    const registered: { offers: Offer[]; market: Market }[] = [];
    const events = await run(port([hit("https://shop.example/a", 299, "USD"), hit("https://shop.example/b", 399, "SGD")]), (offers, market) => registered.push({ offers, market }));
    const products = events.find((e) => e.type === "products");
    if (products?.type !== "products") throw new Error("no products event");
    const shown = products.products.flatMap((p) => p.offerGroups.flatMap((g) => g.offers));
    expect(shown).toHaveLength(2);
    for (const offer of shown) expect(offer.id).toBe(offerId(offer));
    expect(registered).toHaveLength(1);
    expect(registered[0]!.market).toBe("US");
    expect(registered[0]!.offers).toEqual(shown);
  });

  it("gives the same offer the same id on every run, and a different id when the observation differs", async () => {
    const idsOf = async (price: number) => {
      const ids: (string | undefined)[] = [];
      await run(port([hit("https://shop.example/a", price, "USD")]), (offers) => ids.push(...offers.map((o) => o.id)));
      return ids;
    };
    expect(await idsOf(299)).toEqual(await idsOf(299));
    expect(await idsOf(299)).not.toEqual(await idsOf(300));
  });

  it("runs without a registerOffers callback, which leaves ids on the offers", async () => {
    const events = await run(port([hit("https://shop.example/a", 299, "USD")]));
    const products = events.find((e) => e.type === "products");
    expect(products?.type === "products" && products.products[0]?.offerGroups[0]?.offers[0]?.id).toMatch(/^[0-9a-f]{64}$/);
  });
});
