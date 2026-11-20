import { describe, expect, it } from "vitest";
import { canonicalizeUrl, matchesIdentity, resolveCitations } from "../../src/core";

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
