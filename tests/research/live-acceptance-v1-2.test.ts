import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AcceptanceAbort, runAcceptance } from "../../scripts/live/acceptance";
import { dryAcceptanceEnv } from "../../scripts/live/acceptance-env";
import {
  auditAllYes,
  computeThresholds,
  leakProblems,
  loadCase,
  nextRunNumber,
  parseAudit,
  renderAuditTemplate,
  runVerdict,
} from "../../scripts/live/acceptance-log";
import type { ScenarioRecord, ThresholdInput } from "../../scripts/live/acceptance-log";
import { acceptanceBudgetRefusal, addAcceptanceExaRequests, addSmokeExaRequests, readExaCounter } from "../../scripts/live/exa-counter";
import type { Order } from "../../src/core/commerce";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "kensaku-ev023-"));
  dirs.push(d);
  return d;
};

describe("the Exa counter caps", () => {
  it("reads a counter the JM-203 smoke wrote and keeps its fields when EV-023 adds requests", () => {
    const file = join(tmp(), "counter.json");
    addSmokeExaRequests(file, 3);
    expect(readExaCounter(file)).toEqual({ planRequests: 3, smokeRequests: 3 });
    expect(addAcceptanceExaRequests(file, 5)).toEqual({ planRequests: 8, smokeRequests: 3, ev023Requests: 5 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ planRequests: 8, smokeRequests: 3, ev023Requests: 5 });
  });

  it("refuses a research run whose worst case (5 requests) would pass 25 for EV-023 or 30 plan-wide", () => {
    expect(acceptanceBudgetRefusal({ planRequests: 3, smokeRequests: 3 })).toBeUndefined();
    expect(acceptanceBudgetRefusal({ planRequests: 25, smokeRequests: 3, ev023Requests: 20 })).toBeUndefined();
    expect(acceptanceBudgetRefusal({ planRequests: 25, smokeRequests: 3, ev023Requests: 21 })).toMatch(/EV-023 has already spent 21 of its 25/);
    expect(acceptanceBudgetRefusal({ planRequests: 26, smokeRequests: 0, ev023Requests: 0 })).toMatch(/plan has already spent 26 of its 30/);
    expect(acceptanceBudgetRefusal({ planRequests: 25, smokeRequests: 0 })).toBeUndefined();
  });
});

const order = (overrides: Partial<Order> & { orderId: string }): Order => ({
  state: "paid",
  currency: "USD",
  lines: [],
  totalMinor: 1000,
  cartVersion: 1,
  stripeSessionId: `cs_test_${overrides.orderId}`,
  expiresAt: null,
  declinedAttempts: 0,
  awaitingAsyncPayment: false,
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
  transitions: [
    { at: "2026-11-23T00:00:00.000Z", from: null, to: "open" },
    { at: "2026-11-23T00:01:00.000Z", from: "open", to: "paid", eventId: "evt_1" },
  ],
  ...overrides,
});

const scenario = (id: string, verdict: ScenarioRecord["verdict"]): ScenarioRecord => ({ id, by: "agent", verdict, events: [], transitions: [], retrieves: [], checks: {}, observations: {}, notes: [] });
const caps = { ev023: 25, planWide: 30, planWideCostDollars: 0.4, perQuery: 5 };
const session = (orderId: string, extra: Partial<ThresholdInput["sessions"][number]["session"]> = {}) => ({
  label: "final audit",
  sessionId: `cs_test_${orderId}`,
  status: "complete",
  amountTotal: 1000,
  currency: "usd",
  livemode: false,
  ...extra,
});
const paidLine = { eventId: "evt_1", type: "checkout.session.completed", outcome: "applied", orderId: "o1", from: "open", to: "paid" };

const input = (overrides: Partial<ThresholdInput> = {}): ThresholdInput => ({
  scenarios: Array.from({ length: 8 }, (_, i) => scenario(`A${i + 1}`, "PASS")),
  orders: [order({ orderId: "o1" })],
  webhook: [paidLine],
  sessions: [{ order: order({ orderId: "o1" }), session: session("o1") }],
  sandboxSessionId: /^cs_test_/,
  exa: { perQueryAttempts: [{ requests: 3, costDollars: 0.02, cacheHits: 0 }], ev023Requests: 3, ev023CostDollars: 0.02, planRequests: 6, caps },
  ownerAudit: "PENDING",
  ...overrides,
});

describe("computeThresholds", () => {
  it("is clean for a run with one verified paid order, and leaves the audit pending", () => {
    expect(computeThresholds(input())).toEqual({
      scenariosPassing: 8,
      scenariosTotal: 8,
      paidWithoutVerifiedEvent: 0,
      liveModeObjectsSeen: 0,
      duplicatePaidTransitions: 0,
      amountMismatches: 0,
      stripeChargesOutsideSandbox: 0,
      exaWithinBudget: true,
      ownerAuditAllYes: "PENDING",
    });
  });

  it("counts a paid order whose server log has no applied verified event, whatever the other events say", () => {
    const rows = [[], [{ ...paidLine, outcome: "duplicate" }], [{ ...paidLine, type: "checkout.session.expired" }], [{ ...paidLine, orderId: "other" }]];
    for (const webhook of rows) expect(computeThresholds(input({ webhook })).paidWithoutVerifiedEvent).toBe(1);
    expect(computeThresholds(input({ webhook: [{ ...paidLine, type: "checkout.session.async_payment_succeeded" }] })).paidWithoutVerifiedEvent).toBe(0);
  });

  it("counts extra paid transitions, amount or currency differences, live objects and sessions outside the sandbox", () => {
    const twice = order({ orderId: "o1", transitions: [...order({ orderId: "o1" }).transitions, { at: "2026-11-23T00:02:00.000Z", from: "paid", to: "paid" }] });
    expect(computeThresholds(input({ orders: [twice] })).duplicatePaidTransitions).toBe(1);
    const o = order({ orderId: "o1" });
    expect(computeThresholds(input({ sessions: [{ order: o, session: session("o1", { amountTotal: 999 }) }] })).amountMismatches).toBe(1);
    expect(computeThresholds(input({ sessions: [{ order: o, session: session("o1", { currency: "sgd" }) }] })).amountMismatches).toBe(1);
    const live = computeThresholds(input({ sessions: [{ order: o, session: session("o1", { livemode: true }) }], webhook: [paidLine, { outcome: "rejected-livemode" }] }));
    expect(live.liveModeObjectsSeen).toBe(2);
    expect(live.stripeChargesOutsideSandbox).toBe(1);
    expect(computeThresholds(input({ sessions: [{ order: o, session: { ...session("o1"), sessionId: "cs_live_abc" } }] })).stripeChargesOutsideSandbox).toBe(1);
  });

  it("fails the Exa threshold over any cap: per query, EV-023, plan-wide or cost", () => {
    const exa = input().exa;
    expect(computeThresholds(input({ exa: { ...exa, perQueryAttempts: [{ requests: 6, costDollars: 0, cacheHits: 0 }] } })).exaWithinBudget).toBe(false);
    expect(computeThresholds(input({ exa: { ...exa, ev023Requests: 26 } })).exaWithinBudget).toBe(false);
    expect(computeThresholds(input({ exa: { ...exa, planRequests: 31 } })).exaWithinBudget).toBe(false);
    expect(computeThresholds(input({ exa: { ...exa, ev023CostDollars: 0.41 } })).exaWithinBudget).toBe(false);
  });
});

describe("runVerdict", () => {
  const clean = computeThresholds(input());
  it("is PENDING_AUDIT until the audit is recorded, PASS with all yes, FAIL with any no", () => {
    expect(runVerdict(clean, true)).toBe("PENDING_AUDIT");
    expect(runVerdict({ ...clean, ownerAuditAllYes: true }, true)).toBe("PASS");
    expect(runVerdict({ ...clean, ownerAuditAllYes: false }, true)).toBe("FAIL");
  });

  it("fails on a scenario that is not PASS, a failed research check, or any threshold", () => {
    expect(runVerdict({ ...clean, ownerAuditAllYes: true, scenariosPassing: 7 }, true)).toBe("FAIL");
    expect(runVerdict({ ...clean, ownerAuditAllYes: true }, false)).toBe("FAIL");
    expect(runVerdict({ ...clean, ownerAuditAllYes: true, amountMismatches: 1 }, true)).toBe("FAIL");
    expect(runVerdict({ ...clean, exaWithinBudget: false }, true)).toBe("FAIL");
  });
});

describe("the owner audit sheet", () => {
  const c = loadCase();
  const sheet = renderAuditTemplate({ run: 1, logFile: "ev-023-run-1-20261124T000000Z.json", gitSha: "abc", questions: c.ownerAudit });

  it("carries the five frozen questions and starts with every answer pending", () => {
    for (const question of c.ownerAudit) expect(sheet).toContain(question);
    expect(parseAudit(sheet)).toEqual({ H1: "pending", H2: "pending", H3: "pending", H4: "pending", H5: "pending" });
    expect(auditAllYes(parseAudit(sheet))).toBe("PENDING");
  });

  it("reads yes and no case-insensitively and ignores notes", () => {
    const filled = sheet.replace(/Answer:\n/g, "Answer: Yes, all fine\n").replace(/(## H3\n\nQuestion: .*\nAnswer:) Yes, all fine/, "$1 no - Demo checkout price was missing");
    expect(parseAudit(filled)).toMatchObject({ H1: "yes", H3: "no" });
    expect(auditAllYes(parseAudit(filled))).toBe(false);
    expect(auditAllYes(parseAudit(sheet.replace(/Answer:\n/g, "Answer: yes\n")))).toBe(true);
  });

  it("does not take an answer that merely starts with the letters of yes or no", () => {
    expect(parseAudit(sheet.replace("Answer:\n", "Answer: yesterday\n")).H1).toBe("pending");
    expect(parseAudit(sheet.replace("Answer:\n", "Answer: nope\n")).H1).toBe("pending");
  });
});

describe("run numbering", () => {
  const log = (n: number) => `ev-023-run-${n}-2026112${n}T000000Z.json`;
  it("numbers from the run logs present, ignores audit sheets and other logs, and refuses a third run", () => {
    expect(nextRunNumber([])).toBe(1);
    expect(nextRunNumber(["ev-016-run-3-20261121T083658Z.json", "ev-023-run-1-audit.md"])).toBe(1);
    expect(nextRunNumber([log(1), "ev-023-run-1-audit.md"])).toBe(2);
    expect(() => nextRunNumber([log(1), log(2)])).toThrow(/at most 2 runs/);
  });
});

describe("leakProblems", () => {
  it("finds keys, signing secrets and valid card numbers, spaced or not", () => {
    expect(leakProblems(`{"k": "sk_test_${"a".repeat(24)}"}`)).toHaveLength(1);
    expect(leakProblems(`whsec_${"b".repeat(24)}`)).toHaveLength(1);
    for (const card of ["4242 4242 4242 4242", "4242424242424242", "4000-0000-0000-0002", "4000 0070 2000 0003", "4000 0039 2000 0003"]) expect(leakProblems(`card ${card}`)).toEqual(["a full card number"]);
  });

  it("passes order ids, session ids, event ids, timestamps and amounts", () => {
    const clean = `ord_12345678-1234-5678-9012-345678901234 cs_test_a1B2c3D4e5 evt_1QXyz 2026-11-23T10:01:19.123Z 20261123T100119Z 99999999`;
    expect(leakProblems(clean)).toEqual([]);
  });
});

describe("the dry run", () => {
  const c = loadCase();

  it("passes A1-A8 offline, leaves the audit pending, and writes nothing a scan would refuse", async () => {
    const log = await runAcceptance(dryAcceptanceEnv(), c, 0);
    expect(log.scenarios.map((s) => `${s.id}:${s.verdict}`)).toEqual(["A1:PASS", "A2:PASS", "A3:PASS", "A4:PASS", "A5:PASS", "A6:PASS", "A7:PASS", "A8:PASS"]);
    expect(log.thresholds).toMatchObject({ scenariosPassing: 8, paidWithoutVerifiedEvent: 0, liveModeObjectsSeen: 0, duplicatePaidTransitions: 0, amountMismatches: 0, stripeChargesOutsideSandbox: 0, exaWithinBudget: true, ownerAuditAllYes: "PENDING" });
    expect(log.verdict).toBe("PENDING_AUDIT");
    expect(leakProblems(JSON.stringify(log))).toEqual([]);
    expect(JSON.stringify(log)).not.toMatch(/checkout\.stripe\.com|\/__test\/checkout/);
    const [a1, a2, a3, a4, a5, a6, a7, a8] = log.scenarios;
    expect(a1?.events.map((e) => [e.type, e.outcome, e.to])).toEqual([["checkout.session.completed", "applied", "paid"]]);
    expect(a2?.retrieves[0]).toMatchObject({ status: "complete", currency: "sgd" });
    expect(a3?.retrieves[0]).toMatchObject({ status: "complete", currency: "jpy" });
    expect(a4?.observations).toMatchObject({ paymentFailedEventArrived: true, declinedAttempts: 1 });
    expect(a5?.retrieves[0]).toMatchObject({ status: "expired" });
    expect(a6?.observations).toMatchObject({ serverOutcomes: ["applied", "duplicate"] });
    expect(a7?.observations).toMatchObject({ firstOrderTransitions: expect.arrayContaining([expect.objectContaining({ to: "expired" })]) });
    expect(a7?.retrieves.map((r) => r.status)).toEqual(["expired", "open", "expired"]);
    expect(a8?.observations).toMatchObject({ unsignedStatus: 400, wrongSecretStatus: 400, orderStateAfter: "cancelled" });
  });

  it("uses real registered SGD and JPY offers for A2 and A3, never synthetic items", async () => {
    const log = await runAcceptance(dryAcceptanceEnv(), c, 0);
    expect(log.exa.perQuery.map((q) => [q.id, q.checks.addableOfferInMarketCurrency, q.chosenOfferId?.length])).toEqual([["Q1", true, 64], ["Q3", true, 64], ["Q5", true, 64]]);
  });

  it("re-asks a query with no addable local offer once, then marks its scenarios BLOCKED, not FAIL", async () => {
    const log = await runAcceptance(dryAcceptanceEnv(undefined, { Q1: "xm5-us", Q3: "no-market-offers", Q5: "xm5-jp" }), c, 0);
    const q3 = log.exa.perQuery.find((q) => q.id === "Q3");
    expect(q3?.attempts).toHaveLength(2);
    expect(q3?.checks.addableOfferInMarketCurrency).toBe(false);
    expect(log.scenarios.filter((s) => s.verdict === "BLOCKED").map((s) => s.id)).toEqual(["A2", "A5"]);
    expect(log.scenarios.filter((s) => s.verdict === "FAIL")).toEqual([]);
    expect(log.verdict).toBe("FAIL");
  });

  it("starts no research and records BLOCKED when the Exa counter has no room", async () => {
    const env = dryAcceptanceEnv();
    const log = await runAcceptance({ ...env, exaRefusal: () => "the plan has already spent 28 of its 30 live Exa requests." }, c, 0);
    expect(log.exa.ev023Requests).toBe(0);
    expect(log.exa.perQuery.every((q) => q.notes[0]?.includes("no research run started"))).toBe(true);
    expect(log.scenarios.filter((s) => s.verdict === "BLOCKED").map((s) => s.id)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);
  });

  it("stops before any research when a precondition fails", async () => {
    const env = dryAcceptanceEnv();
    let researched = 0;
    const failing = {
      ...env,
      preconditions: async () => [{ name: ".data/commerce/ is empty at the start of the run", ok: false, detail: "found earlier state" }],
      research: async (q: Parameters<typeof env.research>[0]) => {
        researched += 1;
        return env.research(q);
      },
    };
    await expect(runAcceptance(failing, c, 0)).rejects.toThrow(AcceptanceAbort);
    expect(researched).toBe(0);
  });
});
