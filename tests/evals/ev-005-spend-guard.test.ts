// EV-005 Spend guard and cache. Unit level (JM-003) lives here; JM-004 adds the run-level describe.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RequestBudget } from "../../src/exa/budget";
import { ExaSdkPort } from "../../src/exa/sdk-port";
import type { Candidate } from "../../src/core/types";
import { fakeClient, fakeClock, frozen, HttpError, storage } from "../exa/helpers";

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
    expect(store.ledger.read().requests).toBe(1);
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
    expect(store.ledger.read().requests).toBe(2);
    expect(store.ledger.read().costDollars).toBeCloseTo(0.017, 10);
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
    const { fake, port } = setup([search(), search()], { costLimit: 0.012 });
    await port.searchOffers(cand(1), "US", new RequestBudget(5), signal);
    await expect(port.searchOffers(cand(2), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "monthly_limit" });
    expect(fake.calls).toHaveLength(1);
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
    expect(store.ledger.read().exhaustedAt).toBe("2026-11-21T10:00:00.000Z");

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
    expect(store.ledger.month).toBe("2026-12");
    expect(store.ledger.read()).toEqual({ requests: 0, costDollars: 0 });
  });

  it("treats a credit, quota, or billing message as exhausted even without a 402", async () => {
    const { fake, port, store } = setup([new HttpError(400, "Your account has insufficient credits"), search()]);
    await expect(port.searchOffers(cand(1), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "credits_exhausted" });
    expect(store.ledger.read().exhaustedAt).toBeDefined();
    await expect(port.searchOffers(cand(2), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "credits_exhausted" });
    expect(fake.calls).toHaveLength(1);
  });

  it("does not mark credits exhausted for other failures", async () => {
    const { port, store } = setup([new HttpError(500), new HttpError(401)]);
    await expect(port.searchOffers(cand(1), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "upstream" });
    await expect(port.searchOffers(cand(2), "US", new RequestBudget(5), signal)).rejects.toMatchObject({ kind: "auth" });
    expect(store.ledger.read().exhaustedAt).toBeUndefined();
    expect(store.ledger.read().requests).toBe(2);
  });
});
