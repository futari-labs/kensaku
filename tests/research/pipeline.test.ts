import { describe, expect, it } from "vitest";
import type { Candidate, SearchHit } from "../../src/core/types";
import { ExaFailure } from "../../src/exa/errors";
import type { AnswerResult, ExaPort, SearchResult } from "../../src/exa/port";
import type { RunEvent } from "../../src/research/events";
import { runResearch } from "../../src/research/pipeline";
import type { RunOptions } from "../../src/research/pipeline";

const xm5: Candidate = { name: "WH-1000XM5", brand: "Sony", modelIdentifiers: ["WH-1000XM5"] };
const other = (n: number): Candidate => ({ name: `Model ${n}`, brand: "Brand", modelIdentifiers: [`MD-${n}00`] });

const answer = (candidates: Candidate[]): AnswerResult => ({
  comparison: "Good [1].\n\nNo cite here.",
  candidates,
  citationUrls: ["https://review.example/a"],
  exaRequestId: "a1",
  retrievedAt: "2026-11-21T10:00:00.000Z",
  costDollars: 0.005,
  cached: false,
});

const hit = (url: string, productName = "Sony WH-1000XM5"): SearchHit => ({
  url,
  title: "t",
  summary: { isProductListing: true, productName, merchant: "Shop", price: 299, currency: "USD", availability: "in_stock" },
  exaRequestId: "s1",
  retrievedAt: "2026-11-21T10:00:01.000Z",
});
const search = (hits: SearchHit[]): SearchResult => ({ hits, exaRequestId: "s1", retrievedAt: "2026-11-21T10:00:01.000Z", costDollars: 0.015, cached: false });

type Reply<T> = T | Error;
/** A port that takes a budget token per call, like the real one, and replays the replies in order. */
function scripted(answers: Reply<AnswerResult>[], searches: Reply<SearchResult>[]): ExaPort & { searchCalls: number } {
  const port = {
    searchCalls: 0,
    async answerCandidates(_q: string, _m: string, budget: { take(): unknown }) {
      budget.take();
      const r = answers.shift()!;
      if (r instanceof Error) throw r;
      return r;
    },
    async searchOffers(_c: Candidate, _m: string, budget: { take(): unknown }) {
      budget.take();
      port.searchCalls++;
      const r = searches.shift()!;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return port as unknown as ExaPort & { searchCalls: number };
}

async function run(port: ExaPort, options: RunOptions = {}, signal: AbortSignal = new AbortController().signal) {
  const sleeps: number[] = [];
  const events: RunEvent[] = [];
  for await (const e of runResearch({ question: "q", market: "US" }, port, signal, { sleep: async (ms) => void sleeps.push(ms), ...options })) events.push(e);
  return { events, sleeps, end: events.at(-1)!, error: events.find((e) => e.type === "error") };
}

describe("runResearch retries", () => {
  it("retries a 429 once, waiting the reported Retry-After capped at 5 s", async () => {
    const port = scripted([new ExaFailure("rate_limited", "x", { retryAfterMs: 60_000 }), answer([])], []);
    const { sleeps, end } = await run(port);
    expect(sleeps).toEqual([5_000]);
    expect(end).toEqual({ type: "end", state: "completed" });
  });

  it("falls back to a short fixed wait when the 429 carries no Retry-After", async () => {
    const port = scripted([new ExaFailure("rate_limited", "x"), answer([])], []);
    expect((await run(port)).sleeps).toEqual([1_000]);
  });

  it("allows one retry per run in total, not one per call", async () => {
    const port = scripted([answer([xm5, other(2)])], [new ExaFailure("upstream", "x", { status: 503 }), new ExaFailure("upstream", "x", { status: 503 }), search([])]);
    const { sleeps, error, end } = await run(port);
    expect(sleeps).toHaveLength(1);
    expect(error).toMatchObject({ kind: "upstream", partial: true });
    expect(end).toEqual({ type: "end", state: "failed" });
  });

  it("does not retry auth, credit, limit, or a 4xx upstream error", async () => {
    for (const failure of [
      new ExaFailure("auth", "x"),
      new ExaFailure("credits_exhausted", "x"),
      new ExaFailure("monthly_limit", "x"),
      new ExaFailure("upstream", "x", { status: 400 }),
    ]) {
      const { sleeps, error } = await run(scripted([failure], []));
      expect(sleeps).toEqual([]);
      expect(error).toMatchObject({ partial: false });
    }
  });

  it("retries a timeout once", async () => {
    const { sleeps, end } = await run(scripted([new ExaFailure("timeout", "x"), answer([])], []));
    expect(sleeps).toHaveLength(1);
    expect(end.type === "end" && end.state).toBe("completed");
  });
});

describe("runResearch offers stage", () => {
  it("ends the stage early and completes when the budget runs out, saying which candidates were not searched", async () => {
    const port = scripted([answer([xm5, other(2)])], [search([hit("https://shop.example/xm5")]), new ExaFailure("budget_exhausted", "x")]);
    const { events, error, end } = await run(port);
    expect(error).toBeUndefined();
    expect(end).toEqual({ type: "end", state: "completed" });
    const products = events.find((e) => e.type === "products");
    expect(products?.type === "products" && products.products[1]!.notSearched).toBe("Not searched: per-question request limit reached");
  });

  it("searches the third candidate only when the first two yielded no merchant offer", async () => {
    const withOffer = scripted([answer([xm5, other(2), other(3)])], [search([hit("https://shop.example/xm5")]), search([])]);
    const a = await run(withOffer);
    expect(withOffer.searchCalls).toBe(2);
    const products = a.events.find((e) => e.type === "products");
    expect(products?.type === "products" && products.products[2]!.notSearched).toMatch(/earlier candidate had offers/);

    const noOffer = scripted([answer([xm5, other(2), other(3)])], [search([]), search([]), search([])]);
    await run(noOffer);
    expect(noOffer.searchCalls).toBe(3);
  });

  it("shows an offer URL once, under the first candidate that has it", async () => {
    const same = hit("https://shop.example/xm5");
    const port = scripted([answer([xm5, { ...xm5, name: "XM5 again" }])], [search([same]), search([same])]);
    const { events } = await run(port);
    const products = events.find((e) => e.type === "products");
    if (products?.type !== "products") throw new Error("no products");
    expect(products.products[0]!.offerGroups).toHaveLength(1);
    expect(products.products[1]!.offerGroups).toHaveLength(0);
  });
});

describe("runResearch cancellation and deadlines", () => {
  it("a client abort ends the run as cancelled with no error", async () => {
    const abort = new AbortController();
    const port: ExaPort = {
      answerCandidates: (_q, _m, _b, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new ExaFailure("timeout", "aborted")));
          setTimeout(() => abort.abort(), 5);
        }),
      searchOffers: () => Promise.reject(new Error("unreachable")),
    };
    const { events, end } = await run(port, {}, abort.signal);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(end).toEqual({ type: "end", state: "cancelled" });
  });

  it("a call that outlives its timeout fails as a timeout, not as a cancel", async () => {
    const port: ExaPort = {
      answerCandidates: (_q, _m, _b, signal) =>
        new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new ExaFailure("timeout", "slow")))),
      searchOffers: () => Promise.reject(new Error("unreachable")),
    };
    const { error, end } = await run(port, { callTimeoutMs: 10, runTimeoutMs: 1_000 });
    expect(error).toMatchObject({ kind: "timeout" });
    expect(end).toEqual({ type: "end", state: "failed" });
  });
});
