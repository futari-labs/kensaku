import { describe, expect, it } from "vitest";
import { cacheState } from "../../../src/server/images/cache";
import type { CacheEntry } from "../../../src/server/images/cache";
import { withLimit } from "../../../src/server/images/limit";

const HOUR = 3_600_000;
const ok = (fetchedAt: number, size = 10): CacheEntry => ({ registeredAt: 0, size, verdict: { status: "ok", type: "png", fetchedAt } });

describe("cacheState", () => {
  it("is absent without a verdict", () => {
    expect(cacheState({ registeredAt: 0, size: 0 }, 5)).toBe("absent");
  });

  it("reuses ok for 7 days, rejected for 24 hours, and failed for 10 minutes", () => {
    const rejected: CacheEntry = { registeredAt: 0, size: 0, verdict: { status: "rejected", reason: "aspect", fetchedAt: 0 } };
    const failed: CacheEntry = { registeredAt: 0, size: 0, verdict: { status: "failed", reason: "timeout", fetchedAt: 0 } };
    expect([cacheState(ok(0), 168 * HOUR - 1), cacheState(ok(0), 168 * HOUR)]).toEqual(["fresh", "stale"]);
    expect([cacheState(rejected, 24 * HOUR - 1), cacheState(rejected, 24 * HOUR)]).toEqual(["fresh", "stale"]);
    expect([cacheState(failed, 600_000 - 1), cacheState(failed, 600_000)]).toEqual(["fresh", "stale"]);
  });

  it("treats an ok verdict whose bytes are gone as stale", () => {
    expect(cacheState(ok(0, 0), 1)).toBe("stale");
  });
});

describe("withLimit", () => {
  it("never runs more than n tasks at once and runs all of them", async () => {
    const limit = withLimit(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return "done";
    };
    const results = await Promise.all(Array.from({ length: 7 }, () => limit(task)));
    expect(results).toEqual(Array(7).fill("done"));
    expect(peak).toBe(2);
  });

  it("releases its slot when a task throws", async () => {
    const limit = withLimit(1);
    await expect(limit(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await limit(() => Promise.resolve("next"))).toBe("next");
  });
});
