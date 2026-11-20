import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RequestBudget } from "../../src/exa/budget";
import { DiskCache } from "../../src/exa/cache";
import { ExaSdkPort } from "../../src/exa/sdk-port";
import type { Candidate } from "../../src/core/types";
import { fakeClient, fakeClock, frozen, HttpError, storage } from "./helpers";

const candidate: Candidate = { name: "WH-1000XM5", brand: "Sony", modelIdentifiers: ["WH-1000XM5"] };
const signal = new AbortController().signal;
const START = "2026-11-21T10:00:00Z";

/** A live port always has a ledger. */
function livePort(replies: unknown[], extra: Partial<ConstructorParameters<typeof ExaSdkPort>[0]> = {}) {
  const clock = fakeClock(START);
  const store = storage(clock);
  const fake = fakeClient(replies);
  const port = new ExaSdkPort({ client: fake.client, ledger: store.ledger, clock, ...extra });
  return { port, store, calls: fake.calls, clock };
}

describe("ExaSdkPort", () => {
  it("parses a real /answer response into candidates, citations, cost, and Kensaku's receipt time", async () => {
    const { port, calls } = livePort([frozen("A2-answer-schema").response]);
    const r = await port.answerCandidates("best headphones", "SG", new RequestBudget(5), signal);
    expect(r.candidates).toHaveLength(3);
    expect(r.citationUrls).toHaveLength(8);
    expect(r.comparison).toContain("Momentum 4");
    expect(r).toMatchObject({ costDollars: 0.005, exaRequestId: "15d1d62e71cc178b4ab5f25d44b154ff", cached: false });
    expect(r.retrievedAt).toBe("2026-11-21T10:00:00.000Z");
    expect(calls[0]?.options).toMatchObject({ text: false, userLocation: "SG" });
    expect(calls[0]?.call).toMatchObject({ signal, timeout: 30_000 });
  });

  it("can put the market in the question text instead of userLocation", async () => {
    const { port, calls } = livePort([frozen("A2-answer-schema").response], { answerMarketMode: "question-text" });
    await port.answerCandidates("best headphones", "JP", new RequestBudget(5), signal);
    expect(calls[0]?.query).toBe("best headphones\nMarket: Japan");
    expect(calls[0]?.options).not.toHaveProperty("userLocation");
  });

  it("parses a real /search response into hits with parsed summaries", async () => {
    const { port, calls } = livePort([frozen("S8-market-sg").response]);
    const r = await port.searchOffers(candidate, "SG", new RequestBudget(5), signal);
    expect(r.hits).toHaveLength(5);
    expect(r.hits[0]?.summary).toMatchObject({ isProductListing: true, currency: "SGD" });
    expect(r.hits.every((h) => h.retrievedAt === r.retrievedAt && h.exaRequestId === r.exaRequestId)).toBe(true);
    expect(calls[0]?.query).toBe("Sony WH-1000XM5 buy");
    expect(calls[0]?.options).toMatchObject({ type: "auto", numResults: 8, userLocation: "SG" });
  });

  it("turns an unparseable summary into null and rejects a malformed body as upstream", async () => {
    const body = { requestId: "r", results: [{ url: "https://a.example/x", title: null, summary: "not json" }] };
    const { port } = livePort([body, { nonsense: true }]);
    const r = await port.searchOffers(candidate, "US", new RequestBudget(5), signal);
    expect(r.hits[0]).toMatchObject({ summary: null, title: null });
    await expect(port.searchOffers(candidate, "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "upstream" });
  });

  it("maps SDK errors to ExaFailure kinds", async () => {
    const errors: [Error, string][] = [
      [new HttpError(401), "auth"],
      [new HttpError(402), "credits_exhausted"],
      [new HttpError(429, "slow", { retryAfter: 3 }), "rate_limited"],
      [new HttpError(503), "upstream"],
      [Object.assign(new Error("t"), { name: "TimeoutError" }), "timeout"],
    ];
    for (const [error, kind] of errors) {
      const { port } = livePort([error]);
      await expect(port.searchOffers(candidate, "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind });
    }
    const { port: limited } = livePort([new HttpError(429, "slow", { retryAfter: 3 })]);
    await expect(limited.searchOffers(candidate, "US", new RequestBudget(5), signal)).rejects.toMatchObject({ retryAfterMs: 3000 });
  });

  it("makes no call when the signal is already aborted, and takes no token", async () => {
    const { port, calls } = livePort([]);
    const budget = new RequestBudget(5);
    const aborted = AbortSignal.abort();
    await expect(port.answerCandidates("q", "US", budget, aborted)).rejects.toMatchObject({ kind: "timeout" });
    expect(calls).toHaveLength(0);
    expect(budget.used).toBe(0);
  });

  it("never persists the API key: cache and ledger files hold only responses and counts", async () => {
    const key = "exa-test-SECRET-KEY-123";
    const clock = fakeClock(START);
    const { root, cache, ledger } = storage(clock);
    const port = new ExaSdkPort({ client: fakeClient([frozen("S1-headphones").response]).client, cache, ledger, clock });
    await port.searchOffers(candidate, "US", new RequestBudget(5), signal);
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const files = walk(root);
    expect(files).toHaveLength(2);
    for (const f of files) expect(readFileSync(f, "utf8")).not.toContain(key);
    expect(JSON.stringify(port)).not.toContain(key);
  });

  it("counts the cost of a billed response whose body fails strict parsing, then fails as upstream", async () => {
    // The frozen A1 answer is a plain string, not the outputSchema object, and cost $0.005.
    const { port, store } = livePort([frozen("A1-answer").response]);
    await expect(port.answerCandidates("q", "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "upstream" });
    expect(store.usage()).toEqual({ requests: 1, costDollars: 0.005 });
  });

  it("counts the cost of a response that is not even an object, reading nothing it cannot trust", async () => {
    const { port, store } = livePort(["<html>", { costDollars: { total: "free" } }]);
    await expect(port.searchOffers(candidate, "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "upstream" });
    await expect(port.searchOffers(candidate, "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "upstream" });
    // Unreported cost keeps the per-call ceiling (0.02) in the ledger, so the month never under-counts.
    expect(store.usage()).toEqual({ requests: 2, costDollars: 0.04 });
  });

  it("rejects a response without a requestId, and notes a missing cost and records the ceiling for it", async () => {
    const notes: string[] = [];
    const row = { url: "https://a.example/x", title: "t", summary: null };
    const { port, store } = livePort([{ results: [row], costDollars: { total: 0.01 } }, { requestId: "r", results: [row] }], {
      onWarning: (n) => notes.push(n),
    });
    await expect(port.searchOffers(candidate, "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "upstream" });
    expect(store.usage().costDollars).toBe(0.01);
    const ok = await port.searchOffers(candidate, "SG", new RequestBudget(5), signal);
    expect(ok.costDollars).toBe(0);
    expect(notes).toEqual([expect.stringContaining("no costDollars")]);
    expect(store.usage().costDollars).toBeCloseTo(0.03, 10);
  });

  it("skips and counts malformed search rows instead of rejecting the response, and treats null citations as none", async () => {
    const notes: string[] = [];
    const good = { url: "https://a.example/x", title: null, summary: null };
    const { port } = livePort(
      [
        { requestId: "r", results: [good, { nope: 1 }, 7, null, { url: "https://b.example", title: "b" }], costDollars: { total: 0.012 } },
        {
          requestId: "r2",
          answer: { comparison: "c", candidates: [] },
          citations: null,
          costDollars: { total: 0.005 },
        },
      ],
      { onWarning: (n) => notes.push(n) },
    );
    const r = await port.searchOffers(candidate, "US", new RequestBudget(5), signal);
    expect(r.hits.map((h) => h.url)).toEqual(["https://a.example/x", "https://b.example"]);
    expect(notes).toEqual(["Skipped 3 malformed search result row(s)."]);
    expect((await port.answerCandidates("q", "US", new RequestBudget(5), signal)).citationUrls).toEqual([]);
  });

  it("keeps the result when the cache cannot be written, and notes it", async () => {
    const notes: string[] = [];
    const clock = fakeClock(START);
    const store = storage(clock);
    mkdirSync(join(store.root, "exa"), { recursive: true });
    writeFileSync(join(store.root, "exa", "blocker"), "x");
    const brokenCache = new DiskCache({ dir: join(store.root, "exa", "blocker") });
    const port = new ExaSdkPort({
      client: fakeClient([frozen("S1-headphones").response]).client,
      ledger: store.ledger,
      cache: brokenCache,
      clock,
      onWarning: (n) => notes.push(n),
    });
    await expect(port.searchOffers(candidate, "US", new RequestBudget(5), signal)).resolves.toMatchObject({ cached: false });
    expect(notes).toEqual(["Could not write the response to the cache."]);
    expect(store.usage().costDollars).toBeGreaterThan(0);
  });

  it("surfaces an ExaFailure, not a plain error, when the response cost cannot be recorded", async () => {
    const { port, store } = livePort([frozen("S1-headphones").response]);
    // Replace the month file with a directory after the request is counted: the cost write then fails.
    const original = store.ledger.recordCost.bind(store.ledger);
    store.ledger.recordCost = (dollars, now) => {
      rmSync(join(store.root, "ledger", "2026-11.json"));
      mkdirSync(join(store.root, "ledger", "2026-11.json"));
      original(dollars, now);
    };
    await expect(port.searchOffers(candidate, "US", new RequestBudget(5), signal)).rejects.toMatchObject({
      name: "ExaFailure",
      kind: "monthly_limit",
    });
  });

  it("is the only module in src/ that imports exa-js", () => {
    const out = execFileSync("grep", ["-rlE", "from ['\"]exa-js['\"]|require\\(['\"]exa-js", "src"], {
      cwd: join(import.meta.dirname, "../.."),
    }).toString();
    expect(out.trim().split("\n")).toEqual(["src/exa/sdk-port.ts"]);
  });
});
