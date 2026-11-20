import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RequestBudget } from "../../src/exa/budget";
import { ExaSdkPort } from "../../src/exa/sdk-port";
import type { Candidate } from "../../src/core/types";
import { fakeClient, fakeClock, frozen, HttpError, storage } from "./helpers";

const candidate: Candidate = { name: "WH-1000XM5", brand: "Sony", modelIdentifiers: ["WH-1000XM5"] };
const signal = new AbortController().signal;

describe("ExaSdkPort", () => {
  it("parses a real /answer response into candidates, citations, cost, and Kensaku's receipt time", async () => {
    const { client, calls } = fakeClient([frozen("A2-answer-schema").response]);
    const clock = fakeClock("2026-11-21T10:00:00Z");
    const port = new ExaSdkPort({ client, clock });
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
    const { client, calls } = fakeClient([frozen("A2-answer-schema").response]);
    const port = new ExaSdkPort({ client, answerMarketMode: "question-text" });
    await port.answerCandidates("best headphones", "JP", new RequestBudget(5), signal);
    expect(calls[0]?.query).toBe("best headphones\nMarket: Japan");
    expect(calls[0]?.options).not.toHaveProperty("userLocation");
  });

  it("parses a real /search response into hits with parsed summaries", async () => {
    const { client, calls } = fakeClient([frozen("S8-market-sg").response]);
    const r = await new ExaSdkPort({ client, clock: fakeClock("2026-11-21T10:00:00Z") }).searchOffers(
      candidate,
      "SG",
      new RequestBudget(5),
      signal,
    );
    expect(r.hits).toHaveLength(5);
    expect(r.hits[0]?.summary).toMatchObject({ isProductListing: true, currency: "SGD" });
    expect(r.hits.every((h) => h.retrievedAt === r.retrievedAt && h.exaRequestId === r.exaRequestId)).toBe(true);
    expect(calls[0]?.query).toBe("Sony WH-1000XM5 buy");
    expect(calls[0]?.options).toMatchObject({ type: "auto", numResults: 8, userLocation: "SG" });
  });

  it("turns an unparseable summary into null and rejects a malformed body as upstream", async () => {
    const body = { requestId: "r", results: [{ url: "https://a.example/x", title: null, summary: "not json" }] };
    const { client } = fakeClient([body, { nonsense: true }]);
    const port = new ExaSdkPort({ client });
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
      const port = new ExaSdkPort({ client: fakeClient([error]).client });
      await expect(port.searchOffers(candidate, "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind });
    }
    const limited = new ExaSdkPort({ client: fakeClient([new HttpError(429, "slow", { retryAfter: 3 })]).client });
    await expect(limited.searchOffers(candidate, "US", new RequestBudget(5), signal)).rejects.toMatchObject({ retryAfterMs: 3000 });
  });

  it("makes no call when the signal is already aborted, and takes no token", async () => {
    const { client, calls } = fakeClient([]);
    const budget = new RequestBudget(5);
    const aborted = AbortSignal.abort();
    await expect(new ExaSdkPort({ client }).answerCandidates("q", "US", budget, aborted)).rejects.toMatchObject({ kind: "timeout" });
    expect(calls).toHaveLength(0);
    expect(budget.used).toBe(0);
  });

  it("never persists the API key: cache and ledger files hold only responses and counts", async () => {
    const key = "exa-test-SECRET-KEY-123";
    const { client } = fakeClient([frozen("S1-headphones").response]);
    const { root, cache, ledger } = storage(fakeClock("2026-11-21T10:00:00Z"));
    const port = new ExaSdkPort({ client, cache, ledger });
    await port.searchOffers(candidate, "US", new RequestBudget(5), signal);
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const files = walk(root);
    expect(files).toHaveLength(2);
    for (const f of files) expect(readFileSync(f, "utf8")).not.toContain(key);
    expect(JSON.stringify(port)).not.toContain(key);
  });

  it("is the only module in src/ that imports exa-js", () => {
    const out = execFileSync("grep", ["-rlE", "from ['\"]exa-js['\"]|require\\(['\"]exa-js", "src"], {
      cwd: join(import.meta.dirname, "../.."),
    }).toString();
    expect(out.trim().split("\n")).toEqual(["src/exa/sdk-port.ts"]);
  });
});
