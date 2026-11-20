import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StoredSearchSchema } from "../../src/exa/cache";
import { DEFAULT_MONTHLY_COST_LIMIT, DEFAULT_MONTHLY_REQUEST_LIMIT, limitsFromEnv } from "../../src/exa/ledger";
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
    expect(cache.get("k", StoredSearchSchema)?.retrievedAt).toBe("2026-11-21T10:00:00.000Z");
    clock.advance(1);
    expect(cache.get("k", StoredSearchSchema)).toBeUndefined();
  });

  it("treats a missing, corrupt, or wrongly shaped file as a miss", () => {
    const dir = tempDir();
    const cache = new DiskCache({ dir, clock: fakeClock("2026-11-21T10:00:00Z") });
    expect(cache.get("none", StoredSearchSchema)).toBeUndefined();
    writeFileSync(join(dir, "bad.json"), "{not json");
    writeFileSync(join(dir, "shape.json"), JSON.stringify({ version: 1, value: { nope: true } }));
    expect(cache.get("bad", StoredSearchSchema)).toBeUndefined();
    expect(cache.get("shape", StoredSearchSchema)).toBeUndefined();
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
    const { root, ledger } = storage(clock);
    ledger.recordRequest();
    ledger.recordCost(0.012);
    ledger.recordRequest();
    ledger.recordCost(0.005);
    expect(JSON.parse(readFileSync(join(root, "ledger", "2026-11.json"), "utf8"))).toEqual({ requests: 2, costDollars: 0.017 });
    clock.advance(2 * 3600_000);
    expect(ledger.month).toBe("2026-12");
    expect(ledger.read()).toEqual({ requests: 0, costDollars: 0 });
  });

  it("fails closed on an unreadable ledger instead of treating it as empty", () => {
    const dir = tempDir();
    const clock = fakeClock("2026-11-21T10:00:00Z");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-11.json"), "garbage");
    const ledger = new UsageLedger({ dir, clock });
    expect(() => ledger.assertCanCall()).toThrowError(expect.objectContaining({ kind: "monthly_limit" }));
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
