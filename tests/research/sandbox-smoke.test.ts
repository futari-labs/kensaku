import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addSmokeExaRequests, exaBudgetRefusal, readExaCounter } from "../../scripts/live/exa-counter";
import { dryEnv, liveEnv } from "../../scripts/live/sandbox-env";
import { evaluate, redact, runSmoke, SmokeAbort } from "../../scripts/live/sandbox-smoke";
import type { SmokeEvidence } from "../../scripts/live/sandbox-smoke";

describe("redact", () => {
  it("removes keys, signing secrets, bearer tokens and card numbers, and keeps the rest", () => {
    const text = `Invalid API Key provided: sk_test_****abcd; ${"whsec_" + "abcdef0123456789"}; Authorization: Bearer abc.def; card 4242 4242 4242 4242 declined; session cs_test_a1B2 is not open`;
    const out = redact(text);
    for (const secret of ["sk_test_", "whsec_", "abc.def", "4242"]) expect(out).not.toContain(secret);
    expect(out).toContain("session cs_test_a1B2 is not open");
    expect(out).toContain("Invalid API Key provided: [redacted]");
  });

  it("removes restricted and live-looking keys too", () => {
    const tail = "abcdef012345";
    expect(redact(`rk_live_${tail} rkcs_test_${tail} pk_test_${tail}`)).toBe("[redacted] [redacted] [redacted]");
  });
});

describe("the dry run", () => {
  it("passes every check offline and records a log with nothing key-shaped", async () => {
    const evidence = await runSmoke(dryEnv());
    expect(evidence.checks).toEqual(Object.fromEntries(Object.keys(evaluate(evidence)).map((name) => [name, true])));
    expect(evidence.pass).toBe(true);
    expect(evidence.agentSessions.map((s) => s.currency)).toEqual(["USD", "SGD", "JPY"]);
    expect(evidence.purchase).toMatchObject({ finalState: "paid", statesSeen: ["open", "paid"], cartClearedAfter: true });
    expect(evidence.purchase.paidEventId).toMatch(/^evt_/);
    expect(evidence.decline).toMatchObject({ finalState: "cancelled", declinedAttempts: 1, paymentFailedEventArrived: true, cartUnchanged: true });
    expect(evidence.resend).toMatchObject({ duplicateAnswered: true, serverOutcomes: ["applied", "duplicate"], paidTransitionsAfter: 1 });
    expect(evidence.expireAgain.outcome).toBe("error");
    expect(evidence.agentSessions.filter((x) => x.syntheticSessionOnly).map((x) => x.currency)).toEqual(["SGD", "JPY"]);
    for (const synthetic of evidence.agentSessions.filter((x) => x.syntheticSessionOnly)) expect(synthetic.syntheticReason).toMatch(/smoke budget/);
    expect(JSON.stringify(evidence)).not.toMatch(/(?:sk|rk|rkcs|pk)_(?:test|live)_\w{8,}|whsec_\w{8,}/);
  });
});

describe("evaluate", () => {
  const base = (): Promise<SmokeEvidence> => runSmoke(dryEnv());

  it("fails a purchase that was never paid, a resend that was not a duplicate, and Exa over its cap", async () => {
    const e = await base();
    expect(evaluate({ ...e, purchase: { ...e.purchase, finalState: "open" } })["purchase paid after a verified event"]).toBe(false);
    expect(evaluate({ ...e, purchase: { ...e.purchase, statesSeen: ["paid"] } })["purchase paid after a verified event"]).toBe(false);
    expect(evaluate({ ...e, resend: { ...e.resend, serverOutcomes: ["applied", "applied"], duplicateAnswered: false } })["resend answered duplicate, one paid transition"]).toBe(false);
    expect(evaluate({ ...e, exa: { ...e.exa, requests: 6 } })["exa requests within the cap"]).toBe(false);
  });

  it("fails a live-mode session and a session that was not expired", async () => {
    const e = await base();
    const [first, ...rest] = e.agentSessions;
    expect(evaluate({ ...e, agentSessions: [{ ...first!, livemode: true }, ...rest] })["no live-mode session"]).toBe(false);
    expect(evaluate({ ...e, agentSessions: [{ ...first!, statusAfterExpire: "open" }, ...rest] })["usd, sgd and jpy sessions created, retrieved, expired"]).toBe(false);
  });
});

describe("the live env", () => {
  it("refuses to run without a sandbox Stripe key", () => {
    const saved = { key: process.env.STRIPE_SECRET_KEY, secret: process.env.STRIPE_WEBHOOK_SECRET, file: process.env.EXA_ENV_FILE };
    try {
      process.env.EXA_ENV_FILE = "";
      process.env.STRIPE_SECRET_KEY = `sk_live_${"a".repeat(20)}`;
      process.env.STRIPE_WEBHOOK_SECRET = `whsec_${"a".repeat(20)}`;
      expect(() => liveEnv({ offerIds: [], serverLogPath: "/nonexistent", ownerTimeoutMs: 1 })).toThrow(SmokeAbort);
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      expect(() => liveEnv({ offerIds: [], serverLogPath: "/nonexistent", ownerTimeoutMs: 1 })).toThrow(/must both be set/);
    } finally {
      for (const [name, value] of [["STRIPE_SECRET_KEY", saved.key], ["STRIPE_WEBHOOK_SECRET", saved.secret], ["EXA_ENV_FILE", saved.file]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("the plan-wide Exa counter", () => {
  const counterFile = () => join(mkdtempSync(join(tmpdir(), "kensaku-counter-")), "live", "v1-2-exa-counter.json");

  it("starts at zero, persists what the smoke spends, and keeps EV-023's share", () => {
    const file = counterFile();
    expect(readExaCounter(file)).toEqual({ planRequests: 0, smokeRequests: 0 });
    expect(addSmokeExaRequests(file, 2)).toEqual({ planRequests: 2, smokeRequests: 2 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ planRequests: 2, smokeRequests: 2 });
    rmSync(join(file, ".."), { recursive: true, force: true });
  });

  it("refuses a research run whose worst case would pass 5 smoke requests or 30 plan-wide", () => {
    expect(exaBudgetRefusal({ planRequests: 0, smokeRequests: 0 })).toBeUndefined();
    expect(exaBudgetRefusal({ planRequests: 3, smokeRequests: 1 })).toMatch(/smoke has already spent 1 of its 5/);
    expect(exaBudgetRefusal({ planRequests: 26, smokeRequests: 0 })).toMatch(/plan has already spent 26 of its 30/);
    expect(exaBudgetRefusal({ planRequests: 25, smokeRequests: 0 })).toBeUndefined();
  });
});
