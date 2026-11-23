import { MIN_UNIT_MINOR, toMinorUnits } from "../../core/commerce";
import { MARKET_CURRENCY } from "../../core/currency";
import type { Market, Offer, OfferGroup } from "../../core/types";
import type { ProductResult } from "../../research/events";
import type { CartUnavailable } from "./useCart";

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

/** Why an offer cannot be added: `label` is the button's visible text, `detail` the tooltip that explains it. */
export interface BuyBlock {
  label: string;
  detail: string;
}

/** The first reason an offer is not buyable, in the order the server checks them (EV-018), or undefined when it is. */
export function buyBlock({ id, availability, price }: Pick<Offer, "id" | "availability" | "price">, unavailable: CartUnavailable | undefined): BuyBlock | undefined {
  if (unavailable === "corrupt") return { label: "Cart disabled", detail: "Kensaku could not read its commerce data file. See the server log." };
  if (unavailable === "unreachable") return { label: "Cart disabled", detail: "Kensaku's server could not be reached." };
  if (id === undefined) return { label: "Ask again to buy", detail: "This offer was saved before the simulated cart existed. Ask the question again to make it buyable." };
  if (availability === "out_of_stock") return { label: "Out of stock", detail: "The merchant listed this offer as out of stock." };
  const minor = toMinorUnits(price.amount, price.currency);
  if (minor === null) return { label: "Price can't be charged", detail: "This price is not a valid amount in its currency, so it cannot be simulated." };
  if (minor < MIN_UNIT_MINOR) return { label: "Below Stripe's minimum", detail: "Stripe's sandbox cannot charge an amount this small." };
  return undefined;
}
