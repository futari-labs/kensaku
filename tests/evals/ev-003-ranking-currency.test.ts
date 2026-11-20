import { describe, expect, it } from "vitest";
import { rankOffers, type Availability, type Currency, type Market, type Offer } from "../../src/core";
import { makeOffer, mulberry32 } from "../core/offers";
import { readJson } from "../core/fixtures";

// Frozen gold cases: evals/cases/ranking-currency.json (read-only, every case evaluated).
interface RankingCase {
  id: string;
  market: Market;
  offers: { id: string; merchantHost: string; canonicalUrl: string; currency: Currency; amount: number; availability: Availability }[];
  expectedGroups: { currency: Currency; order: string[] }[];
}
const file = readJson<{ cases: RankingCase[] }>("evals/cases/ranking-currency.json");

describe("EV-003 ranking cases", () => {
  it("evaluates every case in the frozen file", () => {
    expect(file.cases.length).toBe(4);
  });

  it.each(file.cases.map((c) => [c.id, c] as const))("%s matches expected groups and order", (_id, c) => {
    const offers = c.offers.map((o) =>
      makeOffer({ merchantHost: o.merchantHost, canonicalUrl: o.canonicalUrl, currency: o.currency, amount: o.amount, availability: o.availability, productName: o.id }),
    );
    const groups = rankOffers(offers, c.market).map((g) => ({ currency: g.currency, order: g.offers.map((o) => o.productName) }));
    expect(groups).toEqual(c.expectedGroups);
  });
});

describe("EV-003 property test (seed 20261121, 1000 lists)", () => {
  const CURRENCIES: Currency[] = ["USD", "SGD", "JPY"];
  const AVAIL: Availability[] = ["in_stock", "out_of_stock", "preorder", "unknown"];
  const MARKETS: Market[] = ["US", "SG", "JP"];

  it("never mixes currencies, loses or duplicates offers, or depends on input order", () => {
    const rand = mulberry32(20261121);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    for (let i = 0; i < 1000; i++) {
      const size = Math.floor(rand() * 30);
      const offers: Offer[] = Array.from({ length: size }, () =>
        makeOffer({
          merchantHost: pick(["a.com", "b.com", "c.sg", "d.jp"]),
          canonicalUrl: `https://${pick(["a.com", "b.com", "c.sg"])}/p/${Math.floor(rand() * 12)}`,
          currency: pick(CURRENCIES),
          amount: Math.floor(rand() * 5) * 10 + 1,
          availability: pick(AVAIL),
          productName: String(Math.floor(rand() * 1e9)),
        }),
      );
      const market = pick(MARKETS);
      const groups = rankOffers(offers, market);

      // Each group holds one currency, groups are distinct, and the market currency leads.
      for (const g of groups) for (const o of g.offers) expect(o.price.currency).toBe(g.currency);
      expect(new Set(groups.map((g) => g.currency)).size).toBe(groups.length);
      if (groups.length > 0 && groups.some((g) => g.currency === { US: "USD", SG: "SGD", JP: "JPY" }[market])) {
        expect(groups[0]!.currency).toBe({ US: "USD", SG: "SGD", JP: "JPY" }[market]);
      }

      // Output is exactly the first-received offer per canonical URL: nothing lost, nothing duplicated.
      const firstByUrl = new Map<string, Offer>();
      for (const o of offers) if (!firstByUrl.has(o.canonicalUrl)) firstByUrl.set(o.canonicalUrl, o);
      const out = groups.flatMap((g) => g.offers);
      expect(out.length).toBe(firstByUrl.size);
      for (const o of out) expect(firstByUrl.get(o.canonicalUrl)).toBe(o);

      // Reversing the input changes nothing once duplicates are removed (the "first received" exception).
      const deduped = [...firstByUrl.values()];
      const forward = rankOffers(deduped, market);
      const backward = rankOffers([...deduped].reverse(), market);
      expect(backward).toEqual(forward);
    }
  });
});
