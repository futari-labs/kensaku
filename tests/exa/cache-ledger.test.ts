import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StoredSearchSchema } from "../../src/exa/schemas";
import { DEFAULT_MONTHLY_COST_LIMIT, DEFAULT_MONTHLY_REQUEST_LIMIT, limitsFromEnv, monthOf } from "../../src/exa/ledger";
import { fakeClock, storage, tempDir } from "./helpers";
import { DiskCache } from "../../src/exa/cache";
import { UsageLedger } from "../../src/exa/ledger";

const entry = (retrievedAt: string) => ({ hits: [], exaRequestId: "r1", retrievedAt, costDollars: 0.012 });

describe("DiskCache", () => {
  it("returns a stored value with its original retrievedAt inside the 6 hour TTL, then expires", () => {
    const clock = fakeClock("2026-11-21T10:00:00Z");
    const { cache } = storage(clock);
    cache.set("k", entry("2026-11-21T10:00:00.000Z"));
    clock.advance(6 * 3600_000 - 1);
    expect(cache.get("k", StoredSearchSchema, clock())?.retrievedAt).toBe("2026-11-21T10:00:00.000Z");
    clock.advance(1);
    expect(cache.get("k", StoredSearchSchema, clock())).toBeUndefined();
  });

  it("treats a missing, corrupt, or wrongly shaped file as a miss", () => {
    const dir = tempDir();
    const cache = new DiskCache({ dir });
    const now = fakeClock("2026-11-21T10:00:00Z")();
    expect(cache.get("none", StoredSearchSchema, now)).toBeUndefined();
    writeFileSync(join(dir, "bad.json"), "{not json");
    writeFileSync(join(dir, "shape.json"), JSON.stringify({ version: 1, value: { nope: true } }));
    expect(cache.get("bad", StoredSearchSchema, now)).toBeUndefined();
    expect(cache.get("shape", StoredSearchSchema, now)).toBeUndefined();
  });

  it("writes atomically: no temporary files remain", () => {
    const { root, cache } = storage(fakeClock("2026-11-21T10:00:00Z"));
    cache.set("k", entry("2026-11-21T10:00:00.000Z"));
    expect(readdirSync(join(root, "exa"))).toEqual(["k.json"]);
  });
});

describe("UsageLedger", () => {
  it("accumulates requests and cost in YYYY-MM.json and starts empty each month", () => {
    const clock = fakeClock("2026-11-30T23:00:00Z");
    const { root, ledger, usage } = storage(clock);
    ledger.recordRequest(clock());
    ledger.recordCost(0.012, clock());
    ledger.recordRequest(clock());
    ledger.recordCost(0.005, clock());
    expect(JSON.parse(readFileSync(join(root, "ledger", "2026-11.json"), "utf8"))).toEqual({ requests: 2, costDollars: 0.017 });
    clock.advance(2 * 3600_000);
    expect(monthOf(clock())).toBe("2026-12");
    expect(usage()).toEqual({ requests: 0, costDollars: 0 });
  });

  it("fails closed on an unreadable ledger instead of treating it as empty", () => {
    const dir = tempDir();
    const clock = fakeClock("2026-11-21T10:00:00Z");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-11.json"), "garbage");
    const ledger = new UsageLedger({ dir });
    expect(() => ledger.assertCanCall(clock())).toThrowError(expect.objectContaining({ kind: "monthly_limit" }));
  });

  it("fails closed when the ledger cannot be written, with an ExaFailure rather than a plain error", () => {
    const dir = tempDir();
    const clock = fakeClock("2026-11-21T10:00:00Z");
    mkdirSync(join(dir, "2026-11.json"), { recursive: true });
    const ledger = new UsageLedger({ dir });
    expect(() => ledger.recordRequest(clock())).toThrowError(expect.objectContaining({ name: "ExaFailure", kind: "monthly_limit" }));
  });

  it("allows a call that exactly fits under the cost limit and blocks one that cannot", () => {
    const clock = fakeClock("2026-11-21T10:00:00Z");
    const { ledger } = storage(clock, { costLimit: 1 });
    ledger.recordCost(0.98, clock());
    expect(() => ledger.assertCanCall(clock())).not.toThrow();
    ledger.recordCost(0.001, clock());
    expect(() => ledger.assertCanCall(clock())).toThrowError(expect.objectContaining({ kind: "monthly_limit" }));
  });

  it("reads limits from the environment with defaults for missing or invalid values", () => {
    expect(limitsFromEnv({})).toEqual({ requestLimit: DEFAULT_MONTHLY_REQUEST_LIMIT, costLimit: DEFAULT_MONTHLY_COST_LIMIT });
    expect(DEFAULT_MONTHLY_REQUEST_LIMIT).toBe(400);
    expect(DEFAULT_MONTHLY_COST_LIMIT).toBe(8);
    expect(limitsFromEnv({ KENSAKU_MONTHLY_REQUEST_LIMIT: "50", KENSAKU_MONTHLY_COST_LIMIT: "2.5" })).toEqual({
      requestLimit: 50,
      costLimit: 2.5,
    });
    expect(limitsFromEnv({ KENSAKU_MONTHLY_REQUEST_LIMIT: "abc", KENSAKU_MONTHLY_COST_LIMIT: "-1" })).toEqual({
      requestLimit: 400,
      costLimit: 8,
    });
  });
});
