// EV-015 check 3 at the unit level: the card heading and image alt name the product once (owner visual review, JM-105), and the
// market of a pre-v1.1 turn is the currency that leads most of its products' offer lists.
import { describe, expect, it } from "vitest";
import type { Currency } from "../../src/core/types";
import type { ProductResult } from "../../src/research/events";
import { productTitle } from "../../src/web/app/format";
import { turnsOf } from "../../src/web/app/messages";
import type { ChatMessage } from "../../src/web/app/messages";

describe("productTitle", () => {
  it("is the name alone when it already starts with the brand", () => {
    expect(productTitle({ brand: "Logitech", name: "Logitech MX Vertical" })).toBe("Logitech MX Vertical");
  });

  it("puts the brand first when the name does not carry it", () => {
    expect(productTitle({ brand: "Sony", name: "WH-1000XM5 Wireless Noise-Cancelling Headphones" })).toBe("Sony WH-1000XM5 Wireless Noise-Cancelling Headphones");
  });

  it("compares case-insensitively after trimming and keeps the name's own spelling", () => {
    expect(productTitle({ brand: " logitech ", name: "  LOGITECH MX Vertical " })).toBe("LOGITECH MX Vertical");
  });

  it("needs a word boundary after the brand, and the brand at the start", () => {
    expect(productTitle({ brand: "Sony", name: "Sonyx Pro" })).toBe("Sony Sonyx Pro");
    expect(productTitle({ brand: "Sony", name: "The Sony Pro" })).toBe("Sony The Sony Pro");
  });

  it("accepts a brand that is the whole name, or followed by punctuation", () => {
    expect(productTitle({ brand: "Sony", name: "Sony" })).toBe("Sony");
    expect(productTitle({ brand: "Sony", name: "Sony-WH1000" })).toBe("Sony-WH1000");
  });

  it("is the name alone for an empty brand", () => {
    expect(productTitle({ brand: "  ", name: "Widget" })).toBe("Widget");
  });
});

const product = (...currencies: Currency[]): ProductResult =>
  ({ candidate: { name: "P", brand: "B", modelIdentifiers: [] }, offerGroups: currencies.map((currency) => ({ currency, offers: [] })) }) as unknown as ProductResult;

const marketFor = (products: ProductResult[]) => {
  const messages: ChatMessage[] = [
    { id: "q", role: "user", parts: [{ type: "text", text: "q" }] },
    { id: "a", role: "assistant", parts: [{ type: "data-products", data: products }] },
  ];
  return turnsOf(messages, { running: false, requestFailed: false })[0]!.market;
};

describe("the market of a turn without question metadata", () => {
  it("is the currency that leads most products' offer lists", () => {
    expect(marketFor([product("USD", "SGD"), product("SGD", "USD"), product("SGD")])).toBe("SG");
  });

  it("goes to the first product's currency on a tie, skipping products without offers", () => {
    expect(marketFor([product(), product("JPY"), product("SGD")])).toBe("JP");
  });

  it("is undefined when no product has offers", () => {
    expect(marketFor([product()])).toBeUndefined();
  });
});
