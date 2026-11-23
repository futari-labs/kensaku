import { MIN_UNIT_MINOR, toMinorUnits } from "../../core/commerce";
import { MARKET_CURRENCY } from "../../core/currency";
import type { Market, Offer, OfferGroup } from "../../core/types";
import type { ProductResult } from "../../research/events";
import type { BuyBlockCode, CartUnavailable } from "./useCart";

/** What a card says about a product's offers. `lowest` counts every listed local offer, out-of-stock ones too. */
export type OfferView =
  | { kind: "notSearched"; message: string }
  | { kind: "none" }
  | { kind: "offers"; market: Market; local: Offer[]; lowest: number | undefined; other: OfferGroup[]; otherCount: number };

/** The selected market's offers lead the card; every other currency waits under "Other markets". */
export function offerView({ notSearched, offerGroups }: Pick<ProductResult, "notSearched" | "offerGroups">, market: Market | undefined): OfferView {
  if (notSearched !== undefined) return { kind: "notSearched", message: notSearched };
  // `market` is only absent when no product in the run has an offer.
  if (market === undefined || offerGroups.length === 0) return { kind: "none" };
  const currency = MARKET_CURRENCY[market];
  const local = offerGroups.find((g) => g.currency === currency)?.offers ?? [];
  const other = offerGroups.filter((g) => g.currency !== currency);
  return {
    kind: "offers",
    market,
    local,
    lowest: local.length > 0 ? Math.min(...local.map((o) => o.price.amount)) : undefined,
    other,
    otherCount: other.reduce((n, g) => n + g.offers.length, 0),
  };
}

export function buyBlock({ id, availability, price }: Pick<Offer, "id" | "availability" | "price">, unavailable: CartUnavailable | undefined): BuyBlockCode | undefined {
  if (unavailable !== undefined) return unavailable;
  if (id === undefined) return "offer-not-registered";
  if (availability === "out_of_stock") return "out-of-stock";
  const minor = toMinorUnits(price.amount, price.currency);
  if (minor === null) return "invalid-price";
  if (minor < MIN_UNIT_MINOR) return "below-minimum";
  return undefined;
}
