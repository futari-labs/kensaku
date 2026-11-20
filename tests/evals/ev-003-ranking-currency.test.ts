import { describe, expect, it } from "vitest";
import { rankOffers, type Availability, type Currency, type Market, type Offer } from "../../src/core";
import { makeOffer, mulberry32 } from "../core/builders";
import { readJson } from "../core/fixtures";

// Frozen gold cases: evals/cases/ranking-currency.json (read-only, every case evaluated).
interface RankingCase {
  id: string;
  market: Market;
  offers: { id: string; merchantHost: string; canonicalUrl: string; currency: Currency; amount: number; availability: Availability }[];
  expectedGroups: { currency: Currency; order: string[] }[];
}
const MARKET_CURRENCY: Record<Market, Currency> = { US: "USD", SG: "SGD", JP: "JPY" };
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
  // Availability rank order from ARCHITECTURE "Ranking": in stock, preorder, unknown, out of stock.
  const AVAIL: Availability[] = ["in_stock", "preorder", "unknown", "out_of_stock"];
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

      // Each group holds one currency; the market currency leads, then USD, SGD, JPY.
      for (const g of groups) for (const o of g.offers) expect(o.price.currency).toBe(g.currency);
      const firstByUrl = new Map<string, Offer>();
      for (const o of offers) if (!firstByUrl.has(o.canonicalUrl)) firstByUrl.set(o.canonicalUrl, o);
      const first = MARKET_CURRENCY[market];
      const expectedOrder = [first, ...CURRENCIES.filter((c) => c !== first)].filter((c) =>
        [...firstByUrl.values()].some((o) => o.price.currency === c),
      );
      expect(groups.map((g) => g.currency)).toEqual(expectedOrder);

      // Within a group: availability rank, amount, merchant host, canonical URL, all ascending.
      for (const g of groups) {
        for (let k = 1; k < g.offers.length; k++) {
          const a = g.offers[k - 1]!;
          const b = g.offers[k]!;
          const key = (o: Offer) => [AVAIL.indexOf(o.availability), o.price.amount, o.merchantHost, o.canonicalUrl] as const;
          const [ka, kb] = [key(a), key(b)];
          const diff = ka.findIndex((v, idx) => v !== kb[idx]);
          if (diff !== -1) expect(ka[diff]! < kb[diff]!).toBe(true);
        }
      }

      // Output is exactly the first-received offer per canonical URL: nothing lost, nothing duplicated.
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
