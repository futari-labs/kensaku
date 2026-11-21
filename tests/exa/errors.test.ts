import { describe, expect, it } from "vitest";
import { ExaFailure, mapExaError } from "../../src/exa/errors";
import { HttpError } from "./helpers";

describe("mapExaError", () => {
  const cases: [string, unknown, string][] = [
    ["401", new HttpError(401), "auth"],
    ["402", new HttpError(402), "credits_exhausted"],
    ["credit text on a 400", new HttpError(400, "You have run out of credits"), "credits_exhausted"],
    ["quota text on a 429", new HttpError(429, "Monthly quota exceeded"), "credits_exhausted"],
    ["billing text", new HttpError(403, "Billing issue on this account"), "credits_exhausted"],
    ["429", new HttpError(429, "Too many requests"), "rate_limited"],
    ["500", new HttpError(500), "upstream"],
    ["503", new HttpError(503), "upstream"],
    ["408", new HttpError(408), "timeout"],
    ["abort", Object.assign(new Error("Request was aborted."), { name: "AbortError" }), "timeout"],
    ["timeout error", Object.assign(new Error("timed out"), { name: "TimeoutError" }), "timeout"],
    ["network failure", new TypeError("fetch failed"), "upstream"],
    ["non-error", "boom", "upstream"],
  ];
  it.each(cases)("%s", (_name, error, kind) => {
    expect(mapExaError(error).kind).toBe(kind);
  });

  it("marks only transient failures retryable: 429, timeout, and 5xx or status-less upstream", () => {
    const retryable = (error: unknown) => mapExaError(error).retryable;
    expect([new HttpError(429), new HttpError(408), new HttpError(500), new HttpError(503), new TypeError("fetch failed")].map(retryable)).toEqual([true, true, true, true, true]);
    expect([new HttpError(400), new HttpError(404), new HttpError(401), new HttpError(402), new HttpError(403)].map(retryable)).toEqual([false, false, false, false, false]);
    expect(new ExaFailure("upstream", "malformed").retryable).toBe(false);
  });

  it("reads retry-after seconds from the error envelope as retryAfterMs", () => {
    expect(mapExaError(new HttpError(429, "slow down", { retryAfter: 2 })).retryAfterMs).toBe(2000);
    expect(mapExaError(new HttpError(429)).retryAfterMs).toBeUndefined();
  });

  it("passes an ExaFailure through and never echoes upstream text", () => {
    const own = new ExaFailure("budget_exhausted", "x");
    expect(mapExaError(own)).toBe(own);
    expect(mapExaError(new HttpError(500, "secret sk-live-123 in message")).message).not.toContain("sk-live-123");
  });
});
