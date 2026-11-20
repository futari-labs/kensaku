// EV-005 Spend guard and cache. Unit level (JM-003) lives here; JM-004 adds the run-level describe.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RequestBudget } from "../../src/exa/budget";
import { monthOf } from "../../src/exa/ledger";
import { ExaSdkPort } from "../../src/exa/sdk-port";
import type { Candidate } from "../../src/core/types";
import { fakeClient, fakeClock, frozen, HttpError, storage } from "../exa/helpers";
import { harness, ofType, readChunks } from "../server/helpers";
import type { Chunk } from "../server/helpers";

const signal = new AbortController().signal;
const cand = (n: number): Candidate => ({ name: `Model ${n}`, brand: "Brand", modelIdentifiers: [`MD-${n}00`] });
const search = () => frozen("S1-headphones").response;
const START = "2026-11-21T10:00:00Z";

function setup(replies: unknown[], limits: { requestLimit?: number; costLimit?: number } = {}) {
  const clock = fakeClock(START);
  const store = storage(clock, limits);
  const fake = fakeClient(replies);
  const port = new ExaSdkPort({ client: fake.client, cache: store.cache, ledger: store.ledger, clock });
  return { clock, store, fake, port };
}

describe("EV-005 unit level: spend guard and cache", () => {
  it("refuses a sixth token, and a sixth call never reaches the SDK", async () => {
    const { fake, port } = setup([search(), search(), search(), search(), search(), search()]);
    const budget = new RequestBudget(5);
    for (let i = 1; i <= 5; i++) await port.searchOffers(cand(i), "US", budget, signal);
    await expect(port.searchOffers(cand(6), "US", budget, signal)).rejects.toMatchObject({ kind: "budget_exhausted" });
    expect(fake.calls).toHaveLength(5);
    expect(budget.used).toBe(5);
  });

  it("serves a repeat from cache with no token, no SDK call, the original retrievedAt, and cached: true", async () => {
    const { clock, fake, port, store } = setup([search()]);
    const first = await port.searchOffers(cand(1), "US", new RequestBudget(5), signal);
    expect(first.cached).toBe(false);
    clock.advance(5 * 3600_000);
    const budget = new RequestBudget(5);
    const again = await port.searchOffers(cand(1), "US", budget, signal);
    expect(again).toMatchObject({ cached: true, retrievedAt: first.retrievedAt, costDollars: 0 });
    expect(again.hits).toEqual(first.hits);
    expect(budget.used).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(store.usage().requests).toBe(1);
  });

  it("calls Exa again after the 6 hour TTL, and keys on market and candidate", async () => {
    const { clock, fake, port } = setup([search(), search(), search(), search()]);
    await port.searchOffers(cand(1), "US", new RequestBudget(5), signal);
    await port.searchOffers(cand(1), "SG", new RequestBudget(5), signal);
    await port.searchOffers(cand(2), "US", new RequestBudget(5), signal);
    expect(fake.calls).toHaveLength(3);
    clock.advance(6 * 3600_000);
    const refreshed = await port.searchOffers(cand(1), "US", new RequestBudget(5), signal);
    expect(refreshed.cached).toBe(false);
    expect(fake.calls).toHaveLength(4);
  });

  it("records each response's cost in the ledger", async () => {
    const { fake, port, store } = setup([search(), frozen("A2-answer-schema").response]);
    await port.searchOffers(cand(1), "US", new RequestBudget(5), signal);
    await port.answerCandidates("best headphones", "US", new RequestBudget(5), signal);
    expect(fake.calls).toHaveLength(2);
    expect(store.usage().requests).toBe(2);
    expect(store.usage().costDollars).toBeCloseTo(0.017, 10);
  });

  it("blocks on the monthly request limit before calling, without spending budget", async () => {
    const { fake, port } = setup([search(), search()], { requestLimit: 2 });
    await port.searchOffers(cand(1), "US", new RequestBudget(5), signal);
    await port.searchOffers(cand(2), "US", new RequestBudget(5), signal);
    const budget = new RequestBudget(5);
    await expect(port.searchOffers(cand(3), "US", budget, signal)).rejects.toMatchObject({ kind: "monthly_limit" });
    expect(fake.calls).toHaveLength(2);
    expect(budget.used).toBe(0);
  });

  it("blocks on the monthly cost limit before calling", async () => {
    const { fake, port } = setup([search(), search()], { costLimit: 0.03 });
    await port.searchOffers(cand(1), "US", new RequestBudget(5), signal);
    await expect(port.searchOffers(cand(2), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "monthly_limit" });
    expect(fake.calls).toHaveLength(1);
  });

  it("blocks when the next call could cross the cost limit, even though the month is still under it", async () => {
    const { fake, port, store } = setup([search()], { costLimit: 8 });
    mkdirSync(join(store.root, "ledger"), { recursive: true });
    writeFileSync(join(store.root, "ledger", "2026-11.json"), JSON.stringify({ requests: 3, costDollars: 7.99 }));
    const budget = new RequestBudget(5);
    await expect(port.searchOffers(cand(1), "US", budget, signal)).rejects.toMatchObject({ kind: "monthly_limit" });
    expect(fake.calls).toHaveLength(0);
    expect(budget.used).toBe(0);
    expect(store.usage()).toEqual({ requests: 3, costDollars: 7.99 });
  });

  it("still serves cache hits when a monthly limit is reached", async () => {
    const { fake, port } = setup([search()], { requestLimit: 1 });
    await port.searchOffers(cand(1), "US", new RequestBudget(5), signal);
    await expect(port.searchOffers(cand(1), "US", new RequestBudget(5), signal)).resolves.toMatchObject({ cached: true });
    expect(fake.calls).toHaveLength(1);
  });

  it("a 402 sets exhaustedAt and blocks every later live call until the ledger is deleted or the month changes", async () => {
    const { clock, fake, port, store } = setup([new HttpError(402, "Payment required"), search(), search()]);
    await expect(port.searchOffers(cand(1), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "credits_exhausted" });
    expect(store.usage().exhaustedAt).toBe("2026-11-21T10:00:00.000Z");

    const budget = new RequestBudget(5);
    await expect(port.searchOffers(cand(2), "US", budget, signal)).rejects.toMatchObject({ kind: "credits_exhausted" });
    await expect(port.answerCandidates("q", "US", budget, signal)).rejects.toMatchObject({ kind: "credits_exhausted" });
    expect(fake.calls).toHaveLength(1);
    expect(budget.used).toBe(0);

    rmSync(join(store.root, "ledger", "2026-11.json"));
    await expect(port.searchOffers(cand(2), "US", new RequestBudget(5), signal)).resolves.toMatchObject({ cached: false });

    await expect(port.searchOffers(cand(3), "US", new RequestBudget(5), signal)).resolves.toBeDefined();
    expect(existsSync(join(store.root, "ledger", "2026-11.json"))).toBe(true);
    clock.advance(10 * 86400_000);
    expect(monthOf(clock())).toBe("2026-12");
    expect(store.usage()).toEqual({ requests: 0, costDollars: 0 });
  });

  it("treats a credit, quota, or billing message as exhausted even without a 402", async () => {
    const { fake, port, store } = setup([new HttpError(400, "Your account has insufficient credits"), search()]);
    await expect(port.searchOffers(cand(1), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "credits_exhausted" });
    expect(store.usage().exhaustedAt).toBeDefined();
    await expect(port.searchOffers(cand(2), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "credits_exhausted" });
    expect(fake.calls).toHaveLength(1);
  });

  it("does not mark credits exhausted for other failures", async () => {
    const { port, store } = setup([new HttpError(500), new HttpError(401)]);
    await expect(port.searchOffers(cand(1), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "upstream" });
    await expect(port.searchOffers(cand(2), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "auth" });
    expect(store.usage().exhaustedAt).toBeUndefined();
    expect(store.usage().requests).toBe(2);
  });
  it("reserves the per-call ceiling for in-flight calls: ledger 7.98 of 8, two parallel searches, the second is blocked before its transport call", async () => {
    const { fake, port, store } = setup([search(), search()], { costLimit: 8 });
    mkdirSync(join(store.root, "ledger"), { recursive: true });
    writeFileSync(join(store.root, "ledger", "2026-11.json"), JSON.stringify({ requests: 3, costDollars: 7.98 }));
    const budgets = [new RequestBudget(5), new RequestBudget(5)];
    const results = await Promise.allSettled([
      port.searchOffers(cand(1), "US", budgets[0]!, signal),
      port.searchOffers(cand(2), "US", budgets[1]!, signal),
    ]);
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: { kind: "monthly_limit" } });
    expect(fake.calls).toHaveLength(1);
    expect(budgets[1]!.used).toBe(0);
    expect(store.usage().costDollars).toBeLessThanOrEqual(8);
  });

  it("keeps the ceiling in the ledger when a call times out or is aborted, since it may still be billed", async () => {
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { port, store } = setup([aborted]);
    await expect(port.searchOffers(cand(1), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "timeout" });
    expect(store.usage()).toEqual({ requests: 1, costDollars: 0.02 });
  });
});

// ---- Run level (JM-004): the app, the pipeline, and the guard together ----

const scenarioNames = readdirSync(join(import.meta.dirname, "../fixtures/scenarios"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const SLOW = new Set(["slow-answer", "cancel-offers"]);
const usageOf = (chunks: Chunk[]) => ofType(chunks, "data-usage")[0]?.data as { exaRequests: number; cacheHits: number } | undefined;
const offersOf = (chunks: Chunk[]) =>
  (ofType(chunks, "data-products")[0]!.data as unknown as { offerGroups: { offers: { retrievedAt: string }[] }[] }[]).flatMap((p) =>
    p.offerGroups.flatMap((g) => g.offers),
  );

describe("EV-005 run level: spend guard through the app", () => {
  it.each(scenarioNames)("scenario %s stays within 5 Exa calls", async (name) => {
    const h = harness();
    const abort = new AbortController();
    const pending = h.chat(name, { signal: abort.signal });
    if (SLOW.has(name)) setTimeout(() => abort.abort(), 40);
    const chunks = await readChunks(await pending).catch(() => []);
    expect(h.ports).toHaveLength(1);
    expect(h.ports[0]!.calls).toBeLessThanOrEqual(5);
    const usage = usageOf(chunks);
    if (usage) expect(usage.exaRequests).toBeLessThanOrEqual(5);
    expect(h.store.usage().requests).toBeLessThanOrEqual(5);
  });

  it("the worst case (three candidates and the retry) makes exactly 5 calls, and no more", async () => {
    const h = harness();
    const chunks = await readChunks(await h.chat("max-calls"));
    expect(h.ports[0]!.calls).toBe(5);
    expect(usageOf(chunks)).toMatchObject({ exaRequests: 5 });
    expect(ofType(chunks, "data-error")).toHaveLength(0);
  });

  it("a normal question uses at most 3 calls", async () => {
    for (const [name, calls] of [["xm5-us", 2], ["two-candidates", 3]] as const) {
      const h = harness();
      const chunks = await readChunks(await h.chat(name));
      expect(h.ports[0]!.calls).toBe(calls);
      expect(usageOf(chunks)!.exaRequests).toBeLessThanOrEqual(3);
    }
  });

  it("a repeat within the TTL uses 0 calls and shows the original retrievedAt", async () => {
    const h = harness({ cache: true });
    const first = await readChunks(await h.chat("xm5-us"));
    h.clock.advance(3600_000);
    const again = await readChunks(await h.chat("xm5-us"));
    expect(h.ports[1]!.calls).toBe(0);
    expect(usageOf(again)).toMatchObject({ exaRequests: 0, cacheHits: 2 });
    const firstOffers = offersOf(first);
    expect(firstOffers.length).toBeGreaterThan(0);
    expect(offersOf(again).map((o) => o.retrievedAt)).toEqual(firstOffers.map((o) => o.retrievedAt));
    expect(h.store.usage().requests).toBe(2);
  });

  it("a second concurrent POST gets 409 before any stream starts, and the lock frees afterwards", async () => {
    const h = harness();
    const abort = new AbortController();
    const first = await h.chat("slow-answer", { signal: abort.signal });
    const second = await h.chat("xm5-us");
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ kind: "run_in_progress" });
    expect(second.headers.get("content-type")).toContain("application/json");
    abort.abort();
    await first.text().catch(() => "");
    expect((await h.chat("xm5-us")).status).toBe(200);
  });
});
