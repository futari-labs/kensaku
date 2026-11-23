// The reasons the commerce UI gives for a disabled "Add to cart" (PRODUCT_SPEC journey step 1), at the unit level.
import { describe, expect, it } from "vitest";
import { buyBlock } from "../../src/web/app/offers";

const base = { id: "a".repeat(64), availability: "in_stock", price: { amount: 198, currency: "USD" } } as const;

describe("buyBlock", () => {
  it("lets an in-stock offer with a chargeable price through", () => {
    expect(buyBlock(base, undefined)).toBeUndefined();
    expect(buyBlock({ ...base, availability: "unknown" }, undefined)).toBeUndefined();
  });

  it.each([
    ["no id", { ...base, id: undefined }, undefined, "Ask again to buy"],
    ["out of stock", { ...base, availability: "out_of_stock" }, undefined, "Out of stock"],
    ["a fraction of a cent", { ...base, price: { amount: 10.005, currency: "USD" } }, undefined, "Price can't be charged"],
    ["a fraction of a yen", { ...base, price: { amount: 100.5, currency: "JPY" } }, undefined, "Price can't be charged"],
    ["below Stripe's minimum", { ...base, price: { amount: 0.49, currency: "USD" } }, undefined, "Below Stripe's minimum"],
    ["an unreadable store", base, "corrupt", "Cart disabled"],
    ["an unreachable server", base, "unreachable", "Cart disabled"],
  ] as const)("says why for %s", (_name, offer, unavailable, label) => {
    expect(buyBlock(offer, unavailable)?.label).toBe(label);
  });

  it("puts the store before the offer, and a missing id before stock", () => {
    expect(buyBlock({ ...base, id: undefined, availability: "out_of_stock" }, undefined)?.label).toBe("Ask again to buy");
    expect(buyBlock({ ...base, id: undefined }, "corrupt")?.label).toBe("Cart disabled");
  });

  it("accepts the smallest chargeable amount", () => {
    expect(buyBlock({ ...base, price: { amount: 0.5, currency: "USD" } }, undefined)).toBeUndefined();
  });
});
