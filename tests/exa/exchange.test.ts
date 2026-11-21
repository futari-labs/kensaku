import { describe, expect, it } from "vitest";
import { RequestBudget } from "../../src/exa/budget";
import { ExaSdkPort } from "../../src/exa/sdk-port";
import { fakeClient, fakeClock, frozen, storage } from "./helpers";

const signal = new AbortController().signal;

describe("onExchange", () => {
  it("hands over each request with the raw response, and a failing observer does not break the call", async () => {
    const raw = frozen("S1-headphones").response;
    const clock = fakeClock("2026-11-21T10:00:00Z");
    const { ledger } = storage(clock);
    const seen: unknown[] = [];
    const notes: string[] = [];
    const port = new ExaSdkPort({
      client: fakeClient([raw, raw]).client,
      ledger,
      clock,
      onWarning: (n) => notes.push(n),
      onExchange: (e) => {
        seen.push(e);
        if (seen.length === 2) throw new Error("disk full");
      },
    });
    const candidate = { name: "WH-1000XM5", brand: "Sony", modelIdentifiers: ["WH-1000XM5"] };
    await port.searchOffers(candidate, "US", new RequestBudget(5), signal);
    expect(seen[0]).toMatchObject({ endpoint: "/search", request: { query: "Sony WH-1000XM5 price United States buy" }, response: raw });
    await expect(port.searchOffers({ ...candidate, name: "other" }, "US", new RequestBudget(5), signal)).resolves.toMatchObject({ cached: false });
    expect(notes).toEqual([expect.stringContaining("exchange observer")]);
  });
});
