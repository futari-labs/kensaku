import type { Availability, Currency, Market, Offer, OfferGroup } from "./types";

const MARKET_CURRENCY: Record<Market, Currency> = { US: "USD", SG: "SGD", JP: "JPY" };
const CURRENCY_ORDER: readonly Currency[] = ["USD", "SGD", "JPY"];
const AVAILABILITY_RANK: Record<Availability, number> = { in_stock: 0, preorder: 1, unknown: 2, out_of_stock: 3 };

function compareCodePoints(a: string, b: string): number {
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done || y.done) return x.done === y.done ? 0 : x.done ? -1 : 1;
    const diff = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (diff !== 0) return diff;
  }
}

function compareOffers(a: Offer, b: Offer): number {
  return (
    AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability] ||
    a.price.amount - b.price.amount ||
    compareCodePoints(a.merchantHost, b.merchantHost) ||
    compareCodePoints(a.canonicalUrl, b.canonicalUrl)
  );
}

/** Groups offers by currency, market currency first, and sorts each group. Never compares across currencies. */
export function rankOffers(offers: Offer[], market: Market): OfferGroup[] {
  const seen = new Set<string>();
  const byCurrency = new Map<Currency, Offer[]>();
  for (const offer of offers) {
    if (seen.has(offer.canonicalUrl)) continue;
    seen.add(offer.canonicalUrl);
    const group = byCurrency.get(offer.price.currency) ?? [];
    group.push(offer);
    byCurrency.set(offer.price.currency, group);
  }
  const first = MARKET_CURRENCY[market];
  const order = [first, ...CURRENCY_ORDER.filter((currency) => currency !== first)];
  return order.flatMap((currency) => {
    const group = byCurrency.get(currency);
    return group ? [{ currency, offers: group.sort(compareOffers) }] : [];
  });
}
