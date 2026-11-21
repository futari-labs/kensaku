// EV-015 check 6 (markets) at the unit level: what `offerView` says about each product, which the card renders through one switch.
import { describe, expect, it } from "vitest";
import type { Currency, Offer, OfferGroup } from "../../src/core/types";
import { offerView } from "../../src/web/app/offers";

const offer = (currency: Currency, amount: number, host: string): Offer => ({
  kind: "merchant-offer",
  merchantHost: host,
  merchantName: host,
  canonicalUrl: `https://${host}/p`,
  price: { amount, currency },
  availability: "in_stock",
  source: "exa",
  retrievedAt: "2026-01-01T00:00:00.000Z",
  exaRequestId: "req",
  productName: "Widget",
});
const group = (currency: Currency, ...amounts: number[]): OfferGroup => ({ currency, offers: amounts.map((a, i) => offer(currency, a, `${currency.toLowerCase()}${i}.example`)) });

describe("offerView", () => {
  it("is notSearched when the product was not searched, whatever offers it carries", () => {
    expect(offerView({ notSearched: "Not searched.", offerGroups: [group("SGD", 5)] }, "SG")).toEqual({ kind: "notSearched", message: "Not searched." });
  });

  it("is none when the product has no offers, or when no market could be settled", () => {
    expect(offerView({ offerGroups: [] }, "SG")).toEqual({ kind: "none" });
    expect(offerView({ offerGroups: [] }, undefined)).toEqual({ kind: "none" });
  });

  it("splits the selected market's offers from the other currencies and takes the lowest listed local price", () => {
    const view = offerView({ offerGroups: [group("SGD", 120, 99.5), group("USD", 80), group("JPY", 9000)] }, "SG");
    expect(view).toMatchObject({ kind: "offers", market: "SG", lowest: 99.5, otherCount: 2 });
    if (view.kind !== "offers") throw new Error("expected offers");
    expect(view.local.map((o) => o.price.amount)).toEqual([120, 99.5]);
    expect(view.other.map((g) => g.currency)).toEqual(["USD", "JPY"]);
  });

  it("has no lowest price when every offer is in another currency", () => {
    const view = offerView({ offerGroups: [group("USD", 80)] }, "SG");
    expect(view).toMatchObject({ kind: "offers", market: "SG", local: [], lowest: undefined, otherCount: 1 });
  });
});
