import { describe, expect, it } from "vitest";
import { canonicalizeUrl, classifyHit, matchesIdentity, resolveCitations, splitParagraphs } from "../../src/core";

describe("canonicalizeUrl", () => {
  it("drops tracking parameters and keeps the rest in order", () => {
    expect(canonicalizeUrl("https://x.com/p?b=2&utm_source=a&a=1&tag=z&ref_=q&gclid=1")).toBe("https://x.com/p?b=2&a=1");
    expect(canonicalizeUrl("https://x.com/p?utm_x=1")).toBe("https://x.com/p");
  });
});

describe("matchesIdentity", () => {
  const c = { name: "n", brand: "b", modelIdentifiers: ["WH-1000XM5", "ab", "Plus"] };
  it("matches runs of tokens and rejects near misses", () => {
    expect(matchesIdentity("Sony WH 1000XM5", c)).toBe(true);
    expect(matchesIdentity("WH-1000XM4", c)).toBe(false);
  });
  it("ignores unusable identifiers", () => {
    expect(matchesIdentity("ab plus", c)).toBe(false);
  });
});

describe("resolveCitations", () => {
  it("keeps resolved numbers when a marker is partly out of range", () => {
    const r = resolveCitations("Claim [1,5].", ["https://a.example"]);
    expect(r.renderedText).toBe("Claim [1].");
    expect(r.unresolvedMarkers).toBe(1);
  });
});

describe("price decimals are exact", () => {
  const candidate = { name: "n", brand: "b", modelIdentifiers: ["WH-1000XM5"] };
  const classify = (price: number, currency: string) => {
    const url = "https://shop.example.com/p";
    const hit = {
      url,
      title: "Sony WH-1000XM5",
      summary: { isProductListing: true, productName: "Sony WH-1000XM5", merchant: "Shop", price, currency },
      exaRequestId: "t",
      retrievedAt: "2026-11-21T00:00:00.000Z",
    };
    return classifyHit(hit, candidate, new Set([url]));
  };

  it("accepts prices within the currency's minor units", () => {
    expect(classify(349.99, "USD").kind).toBe("merchant-offer");
    expect(classify(349, "JPY").kind).toBe("merchant-offer");
  });
  it("rejects float noise and extra decimals", () => {
    for (const [price, currency] of [[349.990000001, "USD"], [0.30000000000000004, "SGD"], [349.5, "JPY"]] as const) {
      const result = classify(price, currency);
      expect(result).toMatchObject({ kind: "evidence", category: "merchant-no-price" });
    }
  });
});

describe("evidence reported price", () => {
  it("shows the currency trimmed and upper-cased", () => {
    const url = "https://www.google.com/shopping/product/1";
    const hit = {
      url,
      title: "Sony WH-1000XM5",
      summary: { productName: "Sony WH-1000XM5", price: 10, currency: " usd " },
      exaRequestId: "t",
      retrievedAt: "2026-11-21T00:00:00.000Z",
    };
    const result = classifyHit(hit, { name: "n", brand: "b", modelIdentifiers: ["WH-1000XM5"] }, new Set([url]));
    expect(result).toMatchObject({ kind: "evidence", reportedPrice: { amount: 10, currency: "USD" } });
  });
});

describe("splitParagraphs and uncited paragraphs", () => {
  const urls = ["https://a.example"];
  it("ignores blank blocks and aligns indexes with splitParagraphs", () => {
    const text = "\n\nFirst [1].\n\n\n\nSecond.\n  \n\nThird [1].\n\n";
    const paragraphs = splitParagraphs(text);
    expect(paragraphs).toEqual(["First [1].", "Second.", "Third [1]."]);
    const r = resolveCitations(text, urls);
    expect(r.uncitedParagraphs).toEqual([1]);
    expect(r.renderedText).toBe(text);
  });
  it("counts a paragraph whose only markers are out of range as uncited", () => {
    const r = resolveCitations("A [9].\n\nB [1].", urls);
    expect(r.uncitedParagraphs).toEqual([0]);
    expect(r.unresolvedMarkers).toBe(1);
    expect(r.sources).toEqual(urls);
    expect(r.renderedText).toBe("A.\n\nB [1].");
  });
  it("de-duplicates sources in first-use order", () => {
    const r = resolveCitations("x [2] y [1,2].", ["https://a.example", "https://b.example"]);
    expect(r.sources).toEqual(["https://b.example", "https://a.example"]);
  });
});
