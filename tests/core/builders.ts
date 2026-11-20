import type { Availability, Currency, Offer } from "../../src/core";

export function makeOffer(o: {
  merchantHost: string;
  canonicalUrl: string;
  currency: Currency;
  amount: number;
  availability: Availability;
  productName?: string;
}): Offer {
  return {
    kind: "merchant-offer",
    merchantHost: o.merchantHost,
    merchantName: o.merchantHost,
    canonicalUrl: o.canonicalUrl,
    price: { amount: o.amount, currency: o.currency },
    availability: o.availability,
    source: "exa",
    retrievedAt: "2026-11-21T00:00:00.000Z",
    exaRequestId: "test",
    productName: o.productName ?? "",
  };
}

/** Small seeded PRNG so the property test is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
