import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { A6_CHECKS, AcceptanceAbort, analyzeResearch, failedResearchRun, noOfferReason, PAY_CHECKS, runAcceptance, scenario, streamProblem, usageOfChunks } from "../../scripts/live/acceptance";
import type { AcceptanceEnv, ResearchRun } from "../../scripts/live/acceptance";
import { dryAcceptanceEnv, evaluateListenLines, probeServerLog, serverLogListens } from "../../scripts/live/acceptance-env";
import {
  auditAllYes,
  checkCaseShape,
  EVIDENCE_DIR,
  computeThresholds,
  leakProblems,
  loadCase,
  logFileName,
  nextRunNumber,
  parseAudit,
  parseRunLog,
  renderAuditTemplate,
  renderStub,
  runVerdict,
  safeLogText,
  withOwnerAudit,
} from "../../scripts/live/acceptance-log";
import type { RunLog, ScenarioRecord, Thresholds, ThresholdInput } from "../../scripts/live/acceptance-log";
import { redact } from "../../scripts/live/sandbox-smoke";
import { acceptanceBudgetRefusal, addAcceptanceExaSpend, addSmokeExaRequests, planUsage, readExaCounter, RUN_EXA_MAX, usageFromEvidence, WORST_CASE_ATTEMPT_COST_DOLLARS } from "../../scripts/live/exa-counter";
import type { Order } from "../../src/core/commerce";
import { MAX_EXA_REQUESTS_PER_RUN } from "../../src/exa/budget";
import { MAX_CALL_COST_DOLLARS } from "../../src/exa/ledger";
import { ofType, parseSse } from "../server/sse";
import type { Chunk } from "../server/sse";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "kensaku-ev023-"));
  dirs.push(d);
  return d;
};

describe("the Exa counter and the plan-wide budget", () => {
  it("reads a counter the JM-203 smoke wrote and keeps its fields when EV-023 adds requests and cost", () => {
    const file = join(tmp(), "counter.json");
    addSmokeExaRequests(file, 3);
    expect(readExaCounter(file)).toEqual({ planRequests: 3, smokeRequests: 3, ev023Requests: 0, planCostDollars: 0 });
    expect(addAcceptanceExaSpend(file, { requests: 5, costDollars: 0.045000000000000005 })).toEqual({ planRequests: 8, smokeRequests: 3, ev023Requests: 5, planCostDollars: 0.045 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ planRequests: 8, smokeRequests: 3, ev023Requests: 5, planCostDollars: 0.045 });
  });

  it("recovers plan-wide usage from the committed logs: the smoke at a bound of 3 x $0.02 plus every EV-023 run log, stubs included", () => {
    const dir = tmp();
    writeFileSync(join(dir, "jm-203-sandbox-smoke-20261123T100119Z.json"), JSON.stringify({ exa: { requests: 3, cap: 5, source: "research" } }));
    expect(usageFromEvidence(dir)).toEqual({ planRequests: 3, planCostDollars: 0.06, ev023Requests: 0 });
    writeFileSync(join(dir, "ev-023-run-1-20261124T000000Z.json"), JSON.stringify({ exa: { ev023Requests: 6, ev023CostDollars: 0.102 } }));
    writeFileSync(join(dir, "ev-023-run-2-20261124T010000Z.json"), renderStub({ mode: "live", run: 2, gitSha: "abc", startedAt: "2026-11-24T01:00:00.000Z", exa: { ev023Requests: 5, ev023CostDollars: 0.1 } }));
    writeFileSync(join(dir, "ev-023-run-2-audit.md"), "not a log");
    expect(usageFromEvidence(dir)).toEqual({ planRequests: 14, planCostDollars: 0.262, ev023Requests: 11 });
    expect(usageFromEvidence(join(dir, "missing"))).toEqual({ planRequests: 0, planCostDollars: 0, ev023Requests: 0 });
  });

  it("refuses to read a log it cannot parse rather than guess zero", () => {
    const dir = tmp();
    writeFileSync(join(dir, "ev-023-run-1-20261124T000000Z.json"), JSON.stringify({ exa: { ev023Requests: "six" } }));
    expect(() => usageFromEvidence(dir)).toThrow();
  });

  it("takes the larger of the local counter and the evidence, per figure", () => {
    const counter = { planRequests: 3, smokeRequests: 3, ev023Requests: 0, planCostDollars: 0 };
    expect(planUsage(counter, { planRequests: 9, planCostDollars: 0.152, ev023Requests: 6 })).toEqual({ planRequests: 9, planCostDollars: 0.152, ev023Requests: 6 });
    expect(planUsage({ ...counter, planRequests: 12, planCostDollars: 0.2, ev023Requests: 9 }, { planRequests: 9, planCostDollars: 0.152, ev023Requests: 6 })).toEqual({ planRequests: 12, planCostDollars: 0.2, ev023Requests: 9 });
  });

  it("takes the worst case of an attempt from the server's own constants: 5 requests at $0.02 is $0.10", () => {
    expect([RUN_EXA_MAX, WORST_CASE_ATTEMPT_COST_DOLLARS]).toEqual([MAX_EXA_REQUESTS_PER_RUN, 0.1]);
    expect(WORST_CASE_ATTEMPT_COST_DOLLARS).toBeCloseTo(MAX_EXA_REQUESTS_PER_RUN * MAX_CALL_COST_DOLLARS, 9);
  });

  it("refuses an attempt whose worst case (5 requests, $0.10) would pass 25 for EV-023, 30 plan-wide or $0.40", () => {
    expect(acceptanceBudgetRefusal({ planRequests: 3, planCostDollars: 0.06, ev023Requests: 0 })).toBeUndefined();
    expect(acceptanceBudgetRefusal({ planRequests: 25, planCostDollars: 0.1, ev023Requests: 20 })).toBeUndefined();
    expect(acceptanceBudgetRefusal({ planRequests: 25, planCostDollars: 0.1, ev023Requests: 21 })).toMatch(/EV-023 has already spent 21 of its 25/);
    expect(acceptanceBudgetRefusal({ planRequests: 26, planCostDollars: 0.1, ev023Requests: 0 })).toMatch(/plan has already spent 26 of its 30/);
    expect(acceptanceBudgetRefusal({ planRequests: 10, planCostDollars: 0.3, ev023Requests: 7 })).toBeUndefined();
    expect(acceptanceBudgetRefusal({ planRequests: 10, planCostDollars: 0.301, ev023Requests: 7 })).toMatch(/\$0\.301 of its \$0\.4/);
  });

  it("settles a reserved worst case down to the actual spend, and never below zero", () => {
    const file = join(tmp(), "counter.json");
    addAcceptanceExaSpend(file, { requests: 5, costDollars: 0.1 });
    expect(addAcceptanceExaSpend(file, { requests: -2, costDollars: -0.06 })).toMatchObject({ planRequests: 3, ev023Requests: 3, planCostDollars: 0.04 });
    expect(addAcceptanceExaSpend(file, { requests: -9, costDollars: -9 })).toMatchObject({ planRequests: 0, planCostDollars: 0 });
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

const record = (id: string, verdict: ScenarioRecord["verdict"]): ScenarioRecord => ({ id, by: "agent", verdict, events: [], transitions: [], retrieves: [], checks: {}, observations: {}, notes: [] });
const caps = { ev023: 25, planWide: 30, planWideCostDollars: 0.4, perQuery: 5 };
const attempt = { requests: 3, costDollars: 0.02, costKnown: true, cacheHits: 0 };
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
  scenarios: Array.from({ length: 8 }, (_, i) => record(`A${i + 1}`, "PASS")),
  scenariosTotal: 8,
  allowances: [],
  orders: [order({ orderId: "o1" })],
  webhook: [paidLine],
  sessions: [{ order: order({ orderId: "o1" }), session: session("o1") }],
  sandboxSessionId: /^cs_test_/,
  exa: { perQueryAttempts: [attempt], ev023Requests: 3, planRequests: 6, planCostDollars: 0.07, caps },
  ownerAudit: "PENDING",
  ...overrides,
});

describe("computeThresholds", () => {
  it("is clean for a run with one verified paid order, and leaves the audit pending", () => {
    expect(computeThresholds(input())).toEqual({
      scenariosPassing: 8,
      scenariosTotal: 8,
      scenariosPassingMet: true,
      blockedAllowancesUsed: [],
      paidWithoutVerifiedEvent: 0,
      liveModeObjectsSeen: 0,
      duplicatePaidTransitions: 0,
      amountMismatches: 0,
      stripeChargesOutsideSandbox: 0,
      exaWithinBudget: true,
      ownerAuditAllYes: "PENDING",
    });
  });

  it("takes the scenario total from the case, not from the records that happened to run", () => {
    expect(computeThresholds(input({ scenarios: [record("A1", "PASS")], scenariosTotal: 8 }))).toMatchObject({ scenariosPassing: 1, scenariosTotal: 8 });
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

  it("fails the Exa threshold over any cap: per attempt, EV-023, plan-wide requests or plan-wide cost", () => {
    const exa = input().exa;
    expect(computeThresholds(input({ exa: { ...exa, perQueryAttempts: [{ ...attempt, requests: 6 }] } })).exaWithinBudget).toBe(false);
    expect(computeThresholds(input({ exa: { ...exa, ev023Requests: 26 } })).exaWithinBudget).toBe(false);
    expect(computeThresholds(input({ exa: { ...exa, planRequests: 31 } })).exaWithinBudget).toBe(false);
    expect(computeThresholds(input({ exa: { ...exa, planCostDollars: 0.41 } })).exaWithinBudget).toBe(false);
  });
});

describe("runVerdict", () => {
  const clean: Thresholds = computeThresholds(input());
  const yes: Thresholds = { ...clean, ownerAuditAllYes: true };

  it("is PENDING_AUDIT until the audit is recorded, PASS with all yes, FAIL with any no", () => {
    expect(runVerdict(clean, true, 0)).toBe("PENDING_AUDIT");
    expect(runVerdict(yes, true, 0)).toBe("PASS");
    expect(runVerdict({ ...clean, ownerAuditAllYes: false }, true, 0)).toBe("FAIL");
  });

  const gated: [string, Partial<Thresholds>][] = [
    ["scenariosPassing", { scenariosPassing: 7 }],
    ["scenariosTotal", { scenariosTotal: 0, scenariosPassing: 0 }],
    ["paidWithoutVerifiedEvent", { paidWithoutVerifiedEvent: 1 }],
    ["liveModeObjectsSeen", { liveModeObjectsSeen: 1 }],
    ["duplicatePaidTransitions", { duplicatePaidTransitions: 1 }],
    ["amountMismatches", { amountMismatches: 1 }],
    ["stripeChargesOutsideSandbox", { stripeChargesOutsideSandbox: 1 }],
    ["exaWithinBudget", { exaWithinBudget: false }],
    ["ownerAuditAllYes", { ownerAuditAllYes: false }],
  ];
  it.each(gated)("is FAIL when %s breaks, with or without a pending audit", (_name, change) => {
    expect(runVerdict({ ...yes, ...change }, true, 0)).toBe("FAIL");
    expect(runVerdict({ ...clean, ...change }, true, 0)).toBe("FAIL");
  });

  it("is FAIL when a research check failed", () => {
    expect(runVerdict(yes, false, 0)).toBe("FAIL");
  });

  it("is BLOCKED when scenarios are blocked and none failed, and FAIL when something also failed", () => {
    const blocked = { ...yes, scenariosPassing: 5, scenariosPassingMet: false };
    expect(runVerdict(blocked, true, 3)).toBe("BLOCKED");
    expect(runVerdict({ ...blocked, scenariosPassing: 4 }, true, 3)).toBe("FAIL");
    expect(runVerdict({ ...blocked, amountMismatches: 1 }, true, 3)).toBe("FAIL");
  });
});

describe("withOwnerAudit", () => {
  const answers = (value: "yes" | "no" | "pending") => ({ H1: value, H2: value, H3: value, H4: value, H5: value });
  const log = async (): Promise<RunLog> => runAcceptance(dryAcceptanceEnv(), loadCase(), 0);

  it("turns a pending audit into PASS with all yes and FAIL with one no", async () => {
    const base = await log();
    expect(base.verdict).toBe("PENDING_AUDIT");
    expect(withOwnerAudit(base, answers("yes"))).toMatchObject({ verdict: "PASS", thresholds: { ownerAuditAllYes: true } });
    expect(withOwnerAudit(base, { ...answers("yes"), H3: "no" })).toMatchObject({ verdict: "FAIL", thresholds: { ownerAuditAllYes: false } });
    expect(withOwnerAudit(base, { ...answers("yes"), H3: "pending" }).verdict).toBe("PENDING_AUDIT");
  });

  it("keeps a deterministic FAIL a FAIL and a BLOCKED a BLOCKED", async () => {
    const base = await log();
    const failed: RunLog = { ...base, thresholds: { ...base.thresholds, amountMismatches: 1 }, verdict: "FAIL" };
    expect(withOwnerAudit(failed, answers("yes")).verdict).toBe("FAIL");
    const blockedScenarios = base.scenarios.map((s, i) => (i < 2 ? { ...s, verdict: "BLOCKED" as const } : s));
    const blocked: RunLog = { ...base, scenarios: blockedScenarios, thresholds: { ...base.thresholds, scenariosPassing: 6, scenariosPassingMet: false }, verdict: "BLOCKED" };
    expect(withOwnerAudit(blocked, answers("yes")).verdict).toBe("BLOCKED");
  });

  it("refuses an aborted run", async () => {
    const base = await log();
    expect(() => withOwnerAudit({ ...base, status: "aborted" }, answers("yes"))).toThrow(/aborted/);
  });

  it("validates a loaded log: another evaluation or task is refused", async () => {
    const base = await log();
    expect(parseRunLog(JSON.stringify(base)).verdict).toBe("PENDING_AUDIT");
    expect(() => parseRunLog(JSON.stringify({ ...base, evaluation: "EV-016" }))).toThrow();
    expect(() => parseRunLog(JSON.stringify({ ...base, task: "JM-203" }))).toThrow();
    expect(() => parseRunLog(JSON.stringify({ ...base, thresholds: {} }))).toThrow();
  });
});

describe("the owner audit sheet", () => {
  const c = loadCase();
  const sheet = renderAuditTemplate({ run: 1, logFile: "ev-023-run-1-20261124T000000Z.json", gitSha: "abc", questions: c.ownerAudit });
  const answered = (value: string) => sheet.replace(/Answer:\n/g, `Answer: ${value}\n`);

  it("carries the five frozen questions and starts with every answer pending", () => {
    for (const question of c.ownerAudit) expect(sheet).toContain(question);
    expect(parseAudit(sheet)).toEqual({ H1: "pending", H2: "pending", H3: "pending", H4: "pending", H5: "pending" });
    expect(auditAllYes(parseAudit(sheet))).toBe("PENDING");
  });

  it("reads exactly yes or no, trimmed, case-insensitive, with trailing punctuation", () => {
    for (const value of ["yes", " Yes ", "YES.", "yes!"]) expect(auditAllYes(parseAudit(answered(value)))).toBe(true);
    const mixed = answered("yes").replace(/(## H3\n\nQuestion: .*\nAnswer:) yes/, "$1 No.");
    expect(parseAudit(mixed)).toMatchObject({ H1: "yes", H3: "no" });
    expect(auditAllYes(parseAudit(mixed))).toBe(false);
  });

  it("leaves anything else pending: a note on the answer line, yesterday, nope, maybe, an empty answer", () => {
    for (const value of ["yes, all fine", "no - the price was missing", "yesterday", "nope", "maybe", "yes no", ""]) expect(parseAudit(answered(value)).H1).toBe("pending");
  });
});

describe("run numbering", () => {
  const log = (n: number) => `ev-023-run-${n}-2026112${n}T000000Z.json`;

  it("numbers from the run logs present, ignores audit sheets and other logs, and refuses a third run", () => {
    expect(nextRunNumber([])).toBe(1);
    expect(nextRunNumber(["ev-016-run-3-20261121T083658Z.json", "ev-023-run-1-audit.md"])).toBe(1);
    expect(nextRunNumber([log(1), "ev-023-run-1-audit.md"])).toBe(2);
    expect(nextRunNumber(["ev-023-run-1-20261123T125703Z.json", "ev-023-run-1-audit.md", "ev-023-run-1-terminal.txt", "ev-023-run-1-server.log"])).toBe(2);
    expect(() => nextRunNumber(["ev-023-run-1-20261123T125703Z.json", "ev-023-run-2-20261124T000000Z.json"])).toThrow(/at most 2 runs/);
    expect(() => nextRunNumber([log(1), log(2)])).toThrow(/at most 2 runs/);
  });

  it("counts a started stub like a finished log, so a crash or Ctrl-C never frees a run", () => {
    const stub = logFileName(1, "2026-11-24T00:00:00.123Z");
    expect(stub).toBe("ev-023-run-1-20261124T000000Z.json");
    expect(nextRunNumber([stub])).toBe(2);
    expect(() => nextRunNumber([stub, logFileName(2, "2026-11-24T01:00:00.000Z")])).toThrow(/at most 2 runs/);
  });
});

describe("leakProblems", () => {
  it("finds keys, signing secrets and valid card numbers, spaced or not", () => {
    expect(leakProblems(`{"k": "sk_test_${"a".repeat(24)}"}`)).toHaveLength(1);
    expect(leakProblems(`whsec_${"b".repeat(24)}`)).toHaveLength(1);
    for (const card of ["4242 4242 4242 4242", "4242424242424242", "4000-0000-0000-0002", "4000 0070 2000 0003", "4000 0039 2000 0003"]) expect(leakProblems(`card ${card}`)).toEqual(["a full card number"]);
    expect(leakProblems(`{"pan": 4242424242424242}`)).toEqual(["a full card number"]);
  });

  it("passes the prefixes the preconditions name in prose, and finds a key built at run time", () => {
    expect(leakProblems("starts sk_test_, rk_test_, or rkcs_test_")).toEqual([]);
    expect(leakProblems("the loaded key does not start sk_test_, rk_test_ or rkcs_test_; whsec_ is the signing secret")).toEqual([]);
    for (const prefix of ["sk_test", "rk_live", "rkcs_test", "pk_test", "whsec"]) expect(leakProblems(`x ${prefix}_${"Ab3".repeat(4)} y`)).toEqual(["a key or signing secret"]);
    expect(redact(`starts sk_test_, then sk_test_${"a".repeat(24)} and whsec_${"b".repeat(24)}`)).toBe("starts sk_test_, then [redacted] and [redacted]");
  });

  it("passes order ids, session ids, event ids, timestamps and amounts", () => {
    const clean = `ord_12345678-1234-5678-9012-345678901234 cs_test_a1B2c3D4e5 evt_1QXyz 2026-11-23T10:01:19.123Z 20261123T100119Z 99999999`;
    expect(leakProblems(clean)).toEqual([]);
  });

  it("passes decimal fractions that float arithmetic leaves behind", () => {
    expect(leakProblems(`{"costDollars": 0.045000000000000005, "total": 0.027000000000000003}`)).toEqual([]);
    expect(leakProblems("cost 0.045000000000000005 then card 4242 4242 4242 4242")).toEqual(["a full card number"]);
    expect(leakProblems(JSON.stringify({ costDollars: [0.045000000000000005, 0.1], ev023CostDollars: 0.027000000000000003 }, null, 2))).toEqual([]);
  });

  it("does not let a decimal hide a card number behind dotted or spaced digit groups", () => {
    for (const evasion of ["4242.4242.4242.4242", "1.4242 4242 4242 4242", "4242 4242 4242 4242 1.5", `{"note": "4242.4242.4242.4242"}`, "x 4000.0000.0000.0002 y"]) expect(leakProblems(evasion)).toEqual(["a full card number"]);
  });
});

describe("safeLogText", () => {
  it("writes a log that leaks nothing as it is", async () => {
    const log = await runAcceptance(dryAcceptanceEnv(), loadCase(), 0);
    expect(JSON.parse(safeLogText(log))).toEqual(log);
  });

  it("scrubs a log that holds a key and says why, instead of writing nothing", async () => {
    const log = await runAcceptance(dryAcceptanceEnv(), loadCase(), 0);
    const leaky: RunLog = { ...log, notes: [`oops sk_test_${"a".repeat(24)} and card 4242 4242 4242 4242`] };
    const text = safeLogText(leaky);
    expect(leakProblems(text)).toEqual([]);
    const parsed = parseRunLog(text);
    expect(parsed.scenarios).toHaveLength(8);
    expect(parsed.notes.join(" ")).toMatch(/leak scan found a key or signing secret and a full card number/);
  });
});

describe("scenario", () => {
  const spec = { id: "A9", by: "agent" as const };

  it("fails with no required checks and with a required check that never ran", async () => {
    expect((await scenario(spec, [], async () => {})).verdict).toBe("FAIL");
    expect((await scenario(spec, ["a", "b"], async (rec) => void (rec.checks.a = true))).verdict).toBe("FAIL");
    expect((await scenario(spec, ["a"], async () => {})).checks).toEqual({ a: false });
  });

  it("passes only when every required check is true", async () => {
    expect((await scenario(spec, ["a", "b"], async (rec) => void Object.assign(rec.checks, { a: true, b: true }))).verdict).toBe("PASS");
    expect((await scenario(spec, ["a", "b"], async (rec) => void Object.assign(rec.checks, { a: true, b: false }))).verdict).toBe("FAIL");
  });

  it("keeps BLOCKED, and fails on a throw even when every check was true", async () => {
    const blocked = await scenario(spec, ["a"], async (rec) => {
      rec.verdict = "BLOCKED";
    });
    expect(blocked.verdict).toBe("BLOCKED");
    const threw = await scenario(spec, ["a"], async (rec) => {
      rec.checks.a = true;
      throw new Error("boom");
    });
    expect(threw.verdict).toBe("FAIL");
    expect(threw.notes[0]).toMatch(/boom/);
  });
});

const dryChunks = async (query: "Q1" | "Q3", scenarioId: string): Promise<Chunk[]> => {
  const env = dryAcceptanceEnv(undefined, { [query]: scenarioId });
  const c = loadCase();
  const q = c.queries.find((candidate) => candidate.id === query);
  if (!q) throw new Error("no such query");
  return (await env.research(q)).chunks;
};

describe("analyzeResearch", () => {
  const c = loadCase();
  const q3 = c.queries.find((q) => q.id === "Q3");
  if (!q3) throw new Error("Q3 missing");

  it("passes the main list check for the recorded SGD run, and lists addable SGD offers", async () => {
    const analysis = analyzeResearch(await dryChunks("Q3", "xm5-sg"), q3, "2026-11-23T00:00:00.000Z");
    expect(analysis.mainListOnlyMarketCurrency).toBe(true);
    expect(analysis.addable.length).toBeGreaterThan(0);
  });

  it("fails the main list check when an offer priced in another currency sits in the market's list", async () => {
    const chunks = await dryChunks("Q3", "xm5-sg");
    const tampered = chunks.map((chunk) => {
      if (chunk.type !== "data-products") return chunk;
      return {
        ...chunk,
        data: chunk.data.map((p) => ({
          ...p,
          offerGroups: p.offerGroups.map((g) => (g.currency === "SGD" ? { ...g, offers: g.offers.map((o, i) => (i === 0 ? { ...o, price: { ...o.price, currency: "USD" as const } } : o)) } : g)),
        })),
      };
    });
    expect(analyzeResearch(tampered, q3, "2026-11-23T00:00:00.000Z").mainListOnlyMarketCurrency).toBe(false);
  });

  it("ignores offers in other markets' currencies, which the card keeps out of the main list", async () => {
    const chunks = await dryChunks("Q3", "xm5-sg");
    const withOther = chunks.map((chunk) =>
      chunk.type !== "data-products" ? chunk : { ...chunk, data: chunk.data.map((p) => ({ ...p, offerGroups: p.offerGroups.filter((g) => g.currency === "SGD") })) },
    );
    expect(analyzeResearch(withOther, q3, "2026-11-23T00:00:00.000Z").mainListOnlyMarketCurrency).toBe(true);
  });

  it("reads a brace in the comparison or in a reason", async () => {
    const chunks = await dryChunks("Q3", "xm5-sg");
    const braced = chunks.map((chunk) => (chunk.type === "text-delta" ? { ...chunk, delta: `${chunk.delta} {price}` } : chunk));
    expect(analyzeResearch(braced, q3, "2026-11-23T00:00:00.000Z").braces).toContain("comparison");
  });
});

describe("what research reports", () => {
  it("counts a missing usage chunk or missing cost at the worst case, never zero", () => {
    expect(usageOfChunks([])).toEqual({ requests: 5, costDollars: 0.1, costKnown: false, cacheHits: 0 });
    const usage: Chunk = { type: "data-usage", id: "usage", data: { exaRequests: 2, cacheHits: 1, costDollars: 0.045000000000000005, monthRequests: 2, monthLimit: 100 } };
    expect(usageOfChunks([usage])).toEqual({ requests: 2, costDollars: 0.045, costKnown: true, cacheHits: 1 });
    expect(failedResearchRun("POST /api/chat answered 500", [], 500)).toMatchObject({ requests: 5, costDollars: 0.1, costKnown: false, httpStatus: 500 });
    expect(failedResearchRun("x", parseSse(`data: ${JSON.stringify(usage)}\n\n`))).toMatchObject({ requests: 2, costDollars: 0.045, costKnown: true });
  });
});

describe("the preconditions", () => {
  const url = "http://127.0.0.1:8787/api/stripe/webhook";
  const events = "checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed";
  const good = `4242 stripe listen --events ${events} --forward-to ${url}`;

  it("accepts one listener that forwards to the server with all five events", () => {
    expect(evaluateListenLines([good, ""])).toMatchObject({ ok: true, matching: [good], rest: [] });
  });

  it("judges each process line on its own, so one line cannot borrow another's events or URL", () => {
    const noEvents = `10 stripe listen --events checkout.session.completed --forward-to ${url}`;
    const noForward = `11 stripe listen --events ${events} --forward-to http://127.0.0.1:9999/other`;
    expect(evaluateListenLines([noEvents, noForward]).ok).toBe(false);
    const result = evaluateListenLines([noEvents, noForward, good]);
    expect(result.ok).toBe(true);
    expect(result.rest.map((r) => r.problems[0])).toEqual([expect.stringContaining("does not subscribe to"), expect.stringContaining("does not forward to")]);
  });

  it("rejects a listener started with --live, none at all, and two matching listeners", () => {
    expect(evaluateListenLines([`${good} --live`]).ok).toBe(false);
    expect(evaluateListenLines([]).ok).toBe(false);
    expect(evaluateListenLines([good, good.replace("4242", "4343")]).ok).toBe(false);
  });

  it("wants this server's listening line, port 8787, live mode, in the --server-log file", () => {
    const line = (port: number, mode: string) => JSON.stringify({ event: "listening", host: "127.0.0.1", port, mode });
    expect(serverLogListens(`noise\n${line(8787, "live")}\n`).ok).toBe(true);
    expect(serverLogListens(line(8787, "fixture")).ok).toBe(false);
    expect(serverLogListens(line(9000, "live")).ok).toBe(false);
    expect(serverLogListens("no listening line here\n").ok).toBe(false);
    expect(serverLogListens(`${line(8787, "live")}\n${line(9000, "live")}`).ok).toBe(false);
  });
});

describe("the server log is tied to the running server", () => {
  const cartLine = JSON.stringify({ ts: "2026-11-24T00:00:00.000Z", event: "cart", op: "remove", result: "not-in-cart" });
  const listening = JSON.stringify({ event: "listening", host: "127.0.0.1", port: 8787, mode: "live" });

  it("accepts a file that gains a cart line after the probe request", async () => {
    let text = `${listening}\n`;
    const result = await probeServerLog({ read: () => text, probe: async () => void (text += `${cartLine}\n`), sleep: async () => {} });
    expect(result.ok).toBe(true);
  });

  it("refuses a stale file the running server never writes to, even one that holds earlier cart lines", async () => {
    const stale = `${listening}\n${cartLine}\n`;
    let sleeps = 0;
    const result = await probeServerLog({ read: () => stale, probe: async () => {}, sleep: async () => void (sleeps += 1) });
    expect(result).toMatchObject({ ok: false, detail: expect.stringMatching(/stale or belongs to another server/) });
    expect(sleeps).toBe(20);
  });

  it("accepts a line that lands a moment after the probe", async () => {
    let text = listening;
    let polls = 0;
    const result = await probeServerLog({ read: () => ((polls += 1) === 4 ? (text += `\n${cartLine}`) : text), probe: async () => {}, sleep: async () => {} });
    expect(result.ok).toBe(true);
  });
});

describe("the frozen case", () => {
  it("asserts A1-A8 with their owner or agent split and queries", () => {
    const c = loadCase();
    expect(c.scenarios.map((s) => [s.id, s.by, s.query])).toEqual([
      ["A1", "owner", "Q1"],
      ["A2", "owner", "Q3"],
      ["A3", "owner", "Q5"],
      ["A4", "owner", "Q1"],
      ["A5", "owner", "Q3"],
      ["A6", "agent", undefined],
      ["A7", "agent", undefined],
      ["A8", "agent", undefined],
    ]);
  });

  it("refuses a case file with a missing, extra, unknown or misassigned scenario", () => {
    const c = loadCase();
    expect(() => checkCaseShape({ ...c, scenarios: c.scenarios.slice(1) })).toThrow(/exactly the scenarios/);
    expect(() => checkCaseShape({ ...c, scenarios: [...c.scenarios, ...c.scenarios.slice(0, 1)] })).toThrow(/exactly the scenarios/);
    expect(() => checkCaseShape({ ...c, scenarios: c.scenarios.map((s) => (s.id === "A2" ? { ...s, query: "Q1" } : s)) })).toThrow(/A2 must be by owner on Q3/);
    expect(() => checkCaseShape({ ...c, scenarios: c.scenarios.map((s) => (s.id === "A6" ? { ...s, by: "owner" as const } : s)) })).toThrow(/A6 must be by agent/);
    expect(() => checkCaseShape({ ...c, queries: c.queries.map((q) => (q.id === "Q5" ? { ...q, currency: "USD" as const } : q)) })).toThrow(/Q5 must be market JP in JPY/);
  });
});

const caseFile = loadCase();
/** Plan-wide usage as the plan stood before any EV-023 run: the committed JM-203 smoke log only, so committed run logs do not shift the figures. */
const smokeOnlyEvidence = (): string => {
  const dir = tmp();
  const smoke = readdirSync(EVIDENCE_DIR).filter((f) => f.startsWith("jm-203-sandbox-smoke-"));
  for (const f of smoke) copyFileSync(join(EVIDENCE_DIR, f), join(dir, f));
  return dir;
};
const run = (env: AcceptanceEnv) => runAcceptance(env, caseFile, 0);
const verdicts = (log: RunLog) => Object.fromEntries(log.scenarios.map((s) => [s.id, s.verdict]));

describe("the dry run", () => {
  it("passes A1-A8 offline, leaves the audit pending, and writes nothing a scan would refuse", async () => {
    const log = await run(dryAcceptanceEnv());
    expect(log.scenarios.map((s) => `${s.id}:${s.verdict}`)).toEqual(["A1:PASS", "A2:PASS", "A3:PASS", "A4:PASS", "A5:PASS", "A6:PASS", "A7:PASS", "A8:PASS"]);
    expect(log.status).toBe("complete");
    expect(log.thresholds).toMatchObject({ scenariosPassing: 8, scenariosTotal: 8, paidWithoutVerifiedEvent: 0, liveModeObjectsSeen: 0, duplicatePaidTransitions: 0, amountMismatches: 0, stripeChargesOutsideSandbox: 0, exaWithinBudget: true, ownerAuditAllYes: "PENDING" });
    expect(log.verdict).toBe("PENDING_AUDIT");
    expect(leakProblems(JSON.stringify(log))).toEqual([]);
    expect(JSON.stringify(log)).not.toMatch(/checkout\.stripe\.com|\/__test\/checkout/);
    const [a1, a2, a3, a4, a5, a6, a7, a8] = log.scenarios;
    expect(a1?.events.map((e) => [e.type, e.outcome, e.to])).toEqual([["checkout.session.completed", "applied", "paid"]]);
    expect(a2?.retrieves[0]).toMatchObject({ status: "complete", currency: "sgd" });
    expect(a3?.retrieves[0]).toMatchObject({ status: "complete", currency: "jpy" });
    expect(a4?.observations).toMatchObject({ paymentFailedEventArrived: true, declinedAttempts: 1 });
    expect(a5?.retrieves[0]).toMatchObject({ status: "expired" });
    expect(a6?.observations).toMatchObject({ serverOutcomes: ["applied", "duplicate"], duplicatesBefore: 0 });
    expect(a7?.observations).toMatchObject({ firstOrderTransitions: expect.arrayContaining([expect.objectContaining({ to: "expired" })]) });
    expect(a7?.retrieves.map((r) => r.status)).toEqual(["expired", "open", "expired"]);
    expect(a8?.observations).toMatchObject({ unsignedStatus: 400, wrongSecretStatus: 400, orderStateAfter: "cancelled" });
  });

  it("computes plan-wide usage from the committed JM-203 smoke log (3 requests, bounded at $0.06) plus the run's own spend", async () => {
    const log = await run(dryAcceptanceEnv(undefined, undefined, smokeOnlyEvidence()));
    expect(log.exa.ev023Requests).toBe(6);
    expect(log.exa.planRequestsAfter).toBe(9);
    expect(log.exa.planCostDollarsAfter).toBeCloseTo(0.06 + log.exa.ev023CostDollars, 6);
  });

  it("uses real registered SGD and JPY offers for A2 and A3, never synthetic items", async () => {
    const log = await run(dryAcceptanceEnv());
    expect(log.exa.perQuery.map((q) => [q.id, q.checks.addableOfferInMarketCurrency, q.chosenOfferId?.length])).toEqual([["Q1", true, 64], ["Q3", true, 64], ["Q5", true, 64]]);
  });

  it("rounds every stored cost to 6 decimals", async () => {
    const log = await run(dryAcceptanceEnv());
    const costs = [...log.exa.perQuery.flatMap((q) => [q.costDollars, ...q.attempts.map((a) => a.costDollars)]), log.exa.ev023CostDollars, log.exa.planCostDollarsAfter];
    for (const cost of costs) expect(Math.round(cost * 1e6) / 1e6).toBe(cost);
  });

  it("re-asks a query with no addable local offer once, then marks its scenarios BLOCKED and the run BLOCKED", async () => {
    const log = await run(dryAcceptanceEnv(undefined, { Q1: "xm5-us", Q3: "no-market-offers", Q5: "xm5-jp" }));
    const q3 = log.exa.perQuery.find((q) => q.id === "Q3");
    expect(q3?.attempts).toHaveLength(2);
    expect(q3?.checks.addableOfferInMarketCurrency).toBe(false);
    expect(log.scenarios.filter((s) => s.verdict === "BLOCKED").map((s) => s.id)).toEqual(["A2", "A5"]);
    expect(log.scenarios.filter((s) => s.verdict === "FAIL")).toEqual([]);
    expect(log.verdict).toBe("BLOCKED");
  });

  it("writes a log with none of the case file's instruction text, preconditions, queries or card numbers", async () => {
    const raw = JSON.parse(readFileSync(join(import.meta.dirname, "../../evals/cases/live-acceptance-v1-2.json"), "utf8")) as { preconditions: string[]; scenarios: { steps: string; expect: string }[]; queries: { text: string }[] };
    const text = safeLogText(await run(dryAcceptanceEnv()));
    const freeText = [...raw.preconditions, ...raw.scenarios.flatMap((s) => [s.steps, s.expect]), ...raw.queries.map((q) => q.text)];
    expect(freeText.length).toBeGreaterThan(15);
    for (const s of freeText) expect(text).not.toContain(s);
    const cards = freeText.flatMap((s) => s.match(/\d{4}(?: \d{4}){3}/g) ?? []);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect([text, text.replaceAll(" ", "")].some((t) => t.includes(card) || t.includes(card.replaceAll(" ", "")))).toBe(false);
    expect(leakProblems(text)).toEqual([]);
  });

  it("starts no research and ends BLOCKED when the Exa budget has no room", async () => {
    const env = dryAcceptanceEnv();
    const log = await run({ ...env, exaRefusal: () => "the plan has already spent 28 of its 30 live Exa requests." });
    expect(log.exa.ev023Requests).toBe(0);
    expect(log.exa.perQuery.every((q) => q.notes[0]?.includes("no research run started"))).toBe(true);
    expect(log.scenarios.filter((s) => s.verdict === "BLOCKED").map((s) => s.id)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);
    expect(log.verdict).toBe("BLOCKED");
  });

  it("stops before any research and before the run is reserved when a precondition fails", async () => {
    const env = dryAcceptanceEnv();
    let researched = 0;
    let reserved = 0;
    const failing = {
      ...env,
      preconditions: async () => [{ name: ".data/commerce/ is empty at the start of the run", ok: false, detail: "found earlier state" }],
      research: async (q: Parameters<typeof env.research>[0]) => {
        researched += 1;
        return env.research(q);
      },
    };
    await expect(runAcceptance(failing, caseFile, 0, () => void (reserved += 1))).rejects.toThrow(AcceptanceAbort);
    expect([researched, reserved]).toEqual([0, 0]);
  });

  it("reserves the run after the preconditions and before the first Exa request", async () => {
    const env = dryAcceptanceEnv();
    const order: string[] = [];
    const probed = {
      ...env,
      preconditions: async () => {
        order.push("preconditions");
        return env.preconditions();
      },
      research: async (q: Parameters<typeof env.research>[0]) => {
        order.push(`research ${q.id}`);
        return env.research(q);
      },
    };
    await runAcceptance(probed, caseFile, 0, ({ startedAt }) => order.push(`reserve ${startedAt.slice(0, 2)}`));
    expect(order.slice(0, 3)).toEqual(["preconditions", "reserve 20", "reserve 20"]);
    expect(order.indexOf("research Q1")).toBeGreaterThan(order.indexOf("reserve 20"));
  });

  it("records spend through the env for every attempt, so the counter sees what each attempt cost", async () => {
    const env = dryAcceptanceEnv();
    const spends: { requests: number; costDollars: number }[] = [];
    await run({ ...env, recordExaSpend: (s) => (spends.push(s), env.recordExaSpend(s)) });
    expect(spends).toHaveLength(6);
    expect(spends.filter((s) => s.requests === 5 && s.costDollars === 0.1)).toHaveLength(3);
    expect(spends.reduce((n, s) => n + s.requests, 0)).toBe(6);
  });

  it("reserves each attempt's worst case in the counter and the log before it runs, and replaces it with the actual spend after", async () => {
    const env = dryAcceptanceEnv();
    const checkpoints: { ev023Requests: number; ev023CostDollars: number }[] = [];
    let counter = { requests: 0, costDollars: 0 };
    const seenDuring: unknown[] = [];
    await runAcceptance(
      {
        ...env,
        recordExaSpend: (s) => {
          counter = { requests: counter.requests + s.requests, costDollars: Math.round((counter.costDollars + s.costDollars) * 1e6) / 1e6 };
          env.recordExaSpend(s);
        },
        research: async (q) => {
          if (q.id === "Q1") seenDuring.push({ counter: { ...counter }, log: checkpoints.at(-1) });
          return env.research(q);
        },
      },
      caseFile,
      0,
      ({ exa }) => checkpoints.push(exa),
    );
    expect(seenDuring[0]).toEqual({ counter: { requests: 5, costDollars: 0.1 }, log: { ev023Requests: 5, ev023CostDollars: 0.1 } });
    expect(counter.requests).toBe(6);
    expect(checkpoints.at(-1)).toEqual({ ev023Requests: 6, ev023CostDollars: counter.costDollars });
  });

  it("leaves the worst case recorded in the counter and the log when an attempt throws mid-way", async () => {
    const env = dryAcceptanceEnv(undefined, undefined, smokeOnlyEvidence());
    const checkpoints: { ev023Requests: number; ev023CostDollars: number }[] = [];
    let counter = { requests: 0, costDollars: 0 };
    const log = await runAcceptance(
      {
        ...env,
        recordExaSpend: (s) => {
          counter = { requests: counter.requests + s.requests, costDollars: Math.round((counter.costDollars + s.costDollars) * 1e6) / 1e6 };
          env.recordExaSpend(s);
        },
        research: async (q) => {
          if (q.id === "Q1") throw new Error("socket hang up");
          return env.research(q);
        },
      },
      caseFile,
      0,
      ({ exa }) => checkpoints.push(exa),
    );
    const q1 = log.exa.perQuery[0];
    expect(q1?.attempts).toEqual([expect.objectContaining({ requests: 5, costDollars: 0.1, costKnown: false }), expect.objectContaining({ requests: 5, costDollars: 0.1 })]);
    expect(counter.requests).toBe(10 + 2 + 2);
    expect(checkpoints.at(-1)?.ev023Requests).toBe(counter.requests);
    expect(log.exa.ev023Requests).toBe(counter.requests);
  });

  it("writes the log with status aborted and the error when the final audit throws", async () => {
    const env = dryAcceptanceEnv();
    const log = await run({ ...env, planUsage: () => { throw new Error("counter unreadable"); } });
    expect(log.status).toBe("aborted");
    expect(log.verdict).toBe("FAIL");
    expect(log.notes.join(" ")).toMatch(/final audit failed: counter unreadable/);
    expect(log.scenarios).toHaveLength(8);
    expect(log.exa.ev023Requests).toBe(6);
  });

  it("writes the log with status aborted when a scenario run itself breaks the flow", async () => {
    const env = dryAcceptanceEnv();
    const log = await run({ ...env, exaRefusal: () => { throw new Error("evidence log unreadable"); } });
    expect(log.status).toBe("aborted");
    expect(log.verdict).toBe("FAIL");
    expect(log.notes.join(" ")).toMatch(/aborted before the run finished: evidence log unreadable/);
  });
});

describe("what makes scenarios and the run FAIL", () => {
  const afterOwnerStep = (env: AcceptanceEnv, change: Partial<AcceptanceEnv> | ((after: { done: boolean }) => Partial<AcceptanceEnv>)): AcceptanceEnv => {
    const state = { done: false };
    const extra = typeof change === "function" ? change(state) : change;
    return {
      ...env,
      ownerStep: async (step, done) => {
        const result = await env.ownerStep(step, done);
        state.done = true;
        return result;
      },
      ...extra,
    };
  };

  it("fails A1 and the run when GET /api/orders/<id> cannot be read after the owner step", async () => {
    const env = dryAcceptanceEnv();
    const broken = afterOwnerStep(env, (state) => ({
      api: async (method, path, body) => (state.done && method === "GET" && /^\/api\/orders\/ord_/.test(path) ? { status: 500, body: {} } : env.api(method, path, body)),
    }));
    const log = await run(broken);
    expect(log.scenarios.find((s) => s.id === "A1")).toMatchObject({ verdict: "FAIL", checks: { orderFound: false, orderPaid: false } });
    expect(["PASS", "PENDING_AUDIT"]).not.toContain(log.verdict);
    expect(log.verdict).toBe("FAIL");
  });

  it("fails A1, A2, A3 and the run on an amount mismatch in the session", async () => {
    const env = dryAcceptanceEnv();
    const real = env.port.retrieveSession.bind(env.port);
    env.port.retrieveSession = async (id) => ({ ...(await real(id)), amountTotal: 1 });
    const log = await run(env);
    expect(["A1", "A2", "A3"].map((id) => verdicts(log)[id])).toEqual(["FAIL", "FAIL", "FAIL"]);
    expect(log.scenarios.find((s) => s.id === "A1")?.checks.sessionCompleteWithDemoTotal).toBe(false);
    expect(log.thresholds.amountMismatches).toBeGreaterThan(0);
    expect(log.verdict).toBe("FAIL");
  });

  it("fails the SGD and JPY scenarios and the run on a currency mismatch", async () => {
    const env = dryAcceptanceEnv();
    const real = env.port.retrieveSession.bind(env.port);
    env.port.retrieveSession = async (id) => ({ ...(await real(id)), currency: "usd" });
    const log = await run(env);
    expect(["A2", "A3"].map((id) => verdicts(log)[id])).toEqual(["FAIL", "FAIL"]);
    expect(log.scenarios.find((s) => s.id === "A2")?.checks.sessionCurrencyMatches).toBe(false);
    expect(log.thresholds.amountMismatches).toBeGreaterThan(0);
    expect(log.verdict).toBe("FAIL");
  });

  it("fails A1 and the run on a duplicate paid transition", async () => {
    const env = dryAcceptanceEnv();
    let a1Order: string | undefined;
    const twice = (o: Order): Order => (o.orderId === a1Order ? { ...o, transitions: [...o.transitions, { at: o.updatedAt, from: "paid", to: "paid" }] } : o);
    const doubled: AcceptanceEnv = {
      ...env,
      api: async (method, path, body) => {
        const reply = await env.api(method, path, body);
        if (method === "POST" && path === "/api/checkout") a1Order ??= (reply.body as { orderId: string }).orderId;
        if (method !== "GET" || reply.status !== 200) return reply;
        if (path === "/api/orders") return { ...reply, body: { orders: (reply.body as { orders: Order[] }).orders.map(twice) } };
        if (/^\/api\/orders\/ord_/.test(path)) return { ...reply, body: { order: twice((reply.body as { order: Order }).order) } };
        return reply;
      },
    };
    const log = await run(doubled);
    expect(log.scenarios.find((s) => s.id === "A1")).toMatchObject({ verdict: "FAIL", checks: { exactlyOnePaidTransition: false } });
    expect(log.thresholds.duplicatePaidTransitions).toBe(1);
    expect(log.verdict).toBe("FAIL");
  });

  it("fails every paid scenario and the run when the server log has no verified paid line", async () => {
    const env = dryAcceptanceEnv();
    const log = await run({ ...env, webhookLog: async () => (await env.webhookLog()).filter((l) => l.to !== "paid") });
    expect(["A1", "A2", "A3"].map((id) => verdicts(log)[id])).toEqual(["FAIL", "FAIL", "FAIL"]);
    expect(log.scenarios.find((s) => s.id === "A1")?.checks.paidByVerifiedCompletedEvent).toBe(false);
    expect(log.thresholds.paidWithoutVerifiedEvent).toBe(3);
    expect(log.verdict).toBe("FAIL");
  });

  it("polls the server log for the verified paid line before judging", async () => {
    const env = dryAcceptanceEnv();
    let reads = 0;
    let slept = 0;
    const late: AcceptanceEnv = {
      ...env,
      sleep: async () => void (slept += 1),
      webhookLog: async () => {
        reads += 1;
        const lines = await env.webhookLog();
        return reads % 3 === 0 || reads > 6 ? lines : lines.filter((l) => l.to !== "paid");
      },
    };
    const log = await run(late);
    expect(log.scenarios.find((s) => s.id === "A1")?.checks.paidByVerifiedCompletedEvent).toBe(true);
    expect(slept).toBeGreaterThan(0);
  });

  it("fails A8 and the run when an unsigned webhook gets 200", async () => {
    const env = dryAcceptanceEnv();
    const log = await run({ ...env, webhook: async (raw, signature) => (signature === undefined ? 200 : env.webhook(raw, signature)) });
    expect(log.scenarios.find((s) => s.id === "A8")).toMatchObject({ verdict: "FAIL", checks: { unsignedRejected400: false, wrongSecretRejected400: true } });
    expect(log.verdict).toBe("FAIL");
  });

  it("fails A6 when the resend leaves no new duplicate line in the server log", async () => {
    const env = dryAcceptanceEnv();
    const log = await run({ ...env, resend: async () => ({ exitCode: 0, output: "dropped" }) });
    const a6 = log.scenarios.find((s) => s.id === "A6");
    expect(a6?.verdict).toBe("FAIL");
    expect(Object.keys(a6?.checks ?? {})).toEqual([...A6_CHECKS]);
    expect(a6?.checks).toMatchObject({ duplicateLineAddedOnce: false, serverAnsweredDuplicate: false });
    expect(log.verdict).toBe("FAIL");
  });

  it("fails A6 when the resend produces two duplicate lines", async () => {
    const env = dryAcceptanceEnv();
    const log = await run({
      ...env,
      resend: async (eventId) => {
        await env.resend(eventId);
        return env.resend(eventId);
      },
    });
    expect(log.scenarios.find((s) => s.id === "A6")).toMatchObject({ verdict: "FAIL", checks: { duplicateLineAddedOnce: false } });
  });

  it("fails an owner scenario whose owner step never finished, and cancels its order", async () => {
    const env = dryAcceptanceEnv();
    const log = await run({ ...env, ownerStep: async () => false });
    expect(log.scenarios.find((s) => s.id === "A1")).toMatchObject({ verdict: "FAIL", checks: { ownerCompletedStep: false } });
    expect(Object.keys(log.scenarios.find((s) => s.id === "A1")?.checks ?? {})).toEqual([...PAY_CHECKS]);
    expect(log.verdict).toBe("FAIL");
  });

  it("counts a live-mode refusal while retrieving a session as a live-mode object", async () => {
    const env = dryAcceptanceEnv();
    const real = env.port.retrieveSession.bind(env.port);
    const { CheckoutPortError } = await import("../../src/commerce/port");
    env.port.retrieveSession = async (id) => {
      if (id.endsWith("_1")) throw new CheckoutPortError("livemode-refused");
      return real(id);
    };
    const log = await run(env);
    expect(log.scenarios.flatMap((s) => s.retrieves).some((r) => r.status === "livemode-refused" && r.livemode)).toBe(true);
    expect(log.thresholds.liveModeObjectsSeen).toBeGreaterThan(0);
    expect(log.verdict).toBe("FAIL");
  });

  it("fails the run when a brace appears in the first attempt and the re-ask is clean", async () => {
    const env = dryAcceptanceEnv(undefined, { Q1: "xm5-us", Q3: "xm5-sg", Q5: "xm5-jp" });
    let q3Asks = 0;
    const braced: AcceptanceEnv = {
      ...env,
      research: async (q) => {
        const result = await env.research(q);
        if (q.id !== "Q3") return result;
        q3Asks += 1;
        if (q3Asks > 1) return result;
        const noOffers = await dryAcceptanceEnv(undefined, { Q3: "no-market-offers" }).research(q);
        return { ...noOffers, chunks: noOffers.chunks.map((chunk) => (chunk.type === "text-delta" ? { ...chunk, delta: `${chunk.delta} {price}` } : chunk)) };
      },
    };
    const log = await run(braced);
    const q3 = log.exa.perQuery.find((q) => q.id === "Q3");
    expect(q3?.attempts).toHaveLength(2);
    expect(q3?.checks).toMatchObject({ addableOfferInMarketCurrency: true, noBraceInComparisonOrReason: false });
    expect(log.researchChecksPass).toBe(false);
    expect(log.verdict).toBe("FAIL");
  });
});

describe("a research failure is a failure, not BLOCKED", () => {
  const failing = (q: { id: string }, counts: { Q5: number }, until = Infinity) => {
    if (q.id !== "Q5") return undefined;
    counts.Q5 += 1;
    return counts.Q5 <= until ? failedResearchRun("POST /api/chat answered 500", [], 500) : undefined;
  };

  it("fails the run when Q5 answers 500 twice, and records A3 as not run because of the research failure", async () => {
    const env = dryAcceptanceEnv();
    const counts = { Q5: 0 };
    const log = await run({ ...env, research: async (q) => failing(q, counts) ?? env.research(q) });
    expect(counts.Q5).toBe(2);
    const q5 = log.exa.perQuery.find((q) => q.id === "Q5");
    expect(q5?.researchError).toMatch(/answered 500/);
    expect(q5?.attempts).toHaveLength(2);
    const a3 = log.scenarios.find((s) => s.id === "A3");
    expect(a3?.verdict).toBe("FAIL");
    expect(a3?.notes.join(" ")).toMatch(/not run: research for Q5 failed/);
    expect(log.researchChecksPass).toBe(false);
    expect(log.verdict).toBe("FAIL");
  });

  it("re-asks once after a 500 and proceeds when the second attempt succeeds", async () => {
    const env = dryAcceptanceEnv();
    const counts = { Q5: 0 };
    const log = await run({ ...env, research: async (q) => failing(q, counts, 1) ?? env.research(q) });
    const q5 = log.exa.perQuery.find((q) => q.id === "Q5");
    expect(q5?.attempts).toHaveLength(2);
    expect(q5?.researchError).toBeUndefined();
    expect(q5?.checks.addableOfferInMarketCurrency).toBe(true);
    expect(log.scenarios.find((s) => s.id === "A3")?.verdict).toBe("PASS");
    expect(log.verdict).toBe("PENDING_AUDIT");
  });

  it("fails on a fetch error and on a malformed stream the same way", async () => {
    for (const bad of [failedResearchRun("POST /api/chat failed: fetch failed"), { chunks: [], requests: 1, costDollars: 0.01, costKnown: true, cacheHits: 0 }]) {
      const env = dryAcceptanceEnv();
      const log = await run({ ...env, research: async (q) => (q.id === "Q1" ? bad : env.research(q)) });
      expect(log.exa.perQuery[0]?.researchError).toBeDefined();
      expect(log.exa.perQuery[0]?.attempts).toHaveLength(2);
      expect(log.verdict).toBe("FAIL");
    }
  });

  it("reads a stream without products as malformed, and one with an error and no products as that error", () => {
    expect(streamProblem([])).toMatch(/malformed/);
    expect(streamProblem([{ type: "data-error", id: "error", data: { kind: "upstream", message: "m", partial: false } }])).toMatch(/upstream error/);
    expect(streamProblem(parseSse(`data: ${JSON.stringify({ type: "data-products", id: "p", data: [] })}\n\n`))).toBeUndefined();
  });

  it("keeps a server-side monthly limit a budget refusal: BLOCKED, never a research error", async () => {
    const env = dryAcceptanceEnv();
    const log = await run({ ...env, research: async (q) => (q.id === "Q1" ? { ...failedResearchRun("x", [], 429), errorKind: "monthly_limit" } : env.research(q)) });
    expect(log.exa.perQuery[0]?.researchError).toBeUndefined();
    expect(log.exa.perQuery[0]?.attempts).toHaveLength(1);
    expect(log.scenarios.find((s) => s.id === "A1")?.verdict).toBe("BLOCKED");
  });

  it("keeps credits_exhausted BLOCKED even after an earlier failed attempt", async () => {
    const env = dryAcceptanceEnv();
    let calls = 0;
    const log = await run({
      ...env,
      research: async (q) => (q.id === "Q1" ? (calls += 1) === 1 ? failedResearchRun("POST /api/chat answered 500", [], 500) : { ...failedResearchRun("x", [], 402), errorKind: "credits_exhausted" } : env.research(q)),
    });
    expect(log.exa.perQuery[0]).toMatchObject({ creditsExhausted: true });
    expect(log.exa.perQuery[0]?.researchError).toBeUndefined();
    expect(log.verdict).toBe("BLOCKED");
  });
});

describe("blockedAllowances (CR-006)", () => {
  const allowance = { scenario: "A3" as const, query: "Q5", when: "Q5 yields no addable JPY offer after the permitted re-ask" };
  const allowed = { ...caseFile, blockedAllowances: [allowance] };
  const withoutAllowances = { ...caseFile, blockedAllowances: [] };
  const noJpy = { Q1: "xm5-us", Q3: "xm5-sg", Q5: "no-market-offers" };
  const runCase = (c: typeof caseFile, env: AcceptanceEnv) => runAcceptance(env, c, 0);

  it("loads a case file with no blockedAllowances as an empty list, and reads the field when present", () => {
    expect(caseFile.blockedAllowances).toEqual(JSON.parse(readFileSync(join(import.meta.dirname, "../../evals/cases/live-acceptance-v1-2.json"), "utf8")).blockedAllowances?.map((a: typeof allowance) => ({ scenario: a.scenario, query: a.query, when: a.when })) ?? []);
    const dir = tmp();
    mkdirSync(join(dir, "evals/cases"), { recursive: true });
    const raw = JSON.parse(readFileSync(join(import.meta.dirname, "../../evals/cases/live-acceptance-v1-2.json"), "utf8"));
    writeFileSync(join(dir, "evals/cases/live-acceptance-v1-2.json"), JSON.stringify({ ...raw, blockedAllowances: [{ ...allowance, coverage: "c", basis: "b" }] }));
    expect(loadCase(dir).blockedAllowances).toEqual([allowance]);
  });

  it("meets the scenarios threshold and ends PENDING_AUDIT when A3 is blocked by no JPY offer and the allowance covers it", async () => {
    const log = await runCase(allowed, dryAcceptanceEnv(undefined, noJpy));
    expect(verdicts(log)).toMatchObject({ A1: "PASS", A2: "PASS", A3: "BLOCKED", A4: "PASS", A8: "PASS" });
    expect(log.scenarios.find((s) => s.id === "A3")?.blockedReason).toBe("no-market-offer-after-reask");
    expect(log.exa.perQuery.find((q) => q.id === "Q5")?.attempts).toHaveLength(2);
    expect(log.scenarios.find((s) => s.id === "A3")?.allowance).toEqual({ id: "A3/Q5", currency: "JPY", marketCurrencyMerchantOffers: 0 });
    expect(log.thresholds).toMatchObject({ scenariosPassing: 7, scenariosTotal: 8, scenariosPassingMet: true, blockedAllowancesUsed: ["A3/Q5"] });
    expect(log.verdict).toBe("PENDING_AUDIT");
    expect(withOwnerAudit(log, { H1: "yes", H2: "yes", H3: "yes", H4: "yes", H5: "yes" }).verdict).toBe("PASS");
    expect(withOwnerAudit(log, { H1: "yes", H2: "yes", H3: "no", H4: "yes", H5: "yes" }).verdict).toBe("FAIL");
  });

  it("stays BLOCKED for the same run without the allowance", async () => {
    const log = await runCase(withoutAllowances, dryAcceptanceEnv(undefined, noJpy));
    expect(log.thresholds).toMatchObject({ scenariosPassingMet: false, blockedAllowancesUsed: [] });
    expect(log.verdict).toBe("BLOCKED");
  });

  it("stays BLOCKED when A3 is blocked by a budget refusal before the first Q5 ask, or before the re-ask", async () => {
    for (const refuseAfter of [2, 3]) {
      const env = dryAcceptanceEnv(undefined, noJpy);
      let asks = 0;
      const log = await runCase(allowed, { ...env, research: async (q) => (asks++, env.research(q)), exaRefusal: () => (asks >= refuseAfter ? "the plan has already spent 28 of its 30 live Exa requests." : undefined) });
      expect(log.scenarios.find((s) => s.id === "A3")).toMatchObject({ verdict: "BLOCKED", blockedReason: "research-incomplete" });
      expect(log.thresholds).toMatchObject({ scenariosPassingMet: false, blockedAllowancesUsed: [] });
      expect(log.verdict).toBe("BLOCKED");
    }
  });

  it("stays BLOCKED when A3 is blocked by exhausted credits or a server-side monthly limit", async () => {
    for (const marker of [{ errorKind: "credits_exhausted", httpStatus: 402 }, { errorKind: "monthly_limit", httpStatus: 429 }]) {
      const env = dryAcceptanceEnv();
      const log = await runCase(allowed, { ...env, research: async (q) => (q.id === "Q5" ? { ...failedResearchRun("x"), ...marker } : env.research(q)) });
      expect(log.scenarios.find((s) => s.id === "A3")?.verdict).toBe("BLOCKED");
      expect(log.thresholds.scenariosPassingMet).toBe(false);
      expect(log.verdict).toBe("BLOCKED");
    }
  });

  it("is FAIL, not covered, when Q5 research failed", async () => {
    const env = dryAcceptanceEnv();
    const log = await runCase(allowed, { ...env, research: async (q) => (q.id === "Q5" ? failedResearchRun("POST /api/chat answered 500", [], 500) : env.research(q)) });
    expect(log.scenarios.find((s) => s.id === "A3")?.verdict).toBe("FAIL");
    expect(log.verdict).toBe("FAIL");
  });

  it("stays BLOCKED when A2 is blocked and only A3 has an allowance, even with A3 blocked too", async () => {
    for (const scenarios of [{ ...noJpy, Q5: "xm5-jp", Q3: "no-market-offers" }, { ...noJpy, Q3: "no-market-offers" }]) {
      const log = await runCase(allowed, dryAcceptanceEnv(undefined, scenarios));
      expect(log.scenarios.find((s) => s.id === "A2")).toMatchObject({ verdict: "BLOCKED", blockedReason: "no-market-offer-after-reask" });
      expect(log.thresholds.scenariosPassingMet).toBe(false);
      expect(log.verdict).toBe("BLOCKED");
    }
  });

  it("records each product's validated outcome as ids, counts and categories only", async () => {
    const log = await runCase(allowed, dryAcceptanceEnv(undefined, { ...noJpy, Q5: "xm5-jp" }));
    const q5 = log.exa.perQuery.find((q) => q.id === "Q5");
    expect(q5?.products.length).toBeGreaterThan(0);
    expect(q5?.products.reduce((n, p) => n + p.marketCurrencyOffers.count, 0)).toBe(q5?.products.flatMap((p) => p.marketCurrencyOffers.ids).length);
    for (const p of q5?.products ?? []) expect(Object.keys(p).sort()).toEqual(["evidence", "marketCurrencyOffers", "otherCurrencyOffers", "rejected"]);
    expect(JSON.stringify(q5?.products)).not.toMatch(/https?:|\.com/);
    const noOffer = await runCase(allowed, dryAcceptanceEnv(undefined, noJpy));
    expect(noOffer.exa.perQuery.find((q) => q.id === "Q5")?.products.some((p) => p.otherCurrencyOffers + Object.keys(p.evidence).length > 0)).toBe(true);
  });

  it("names the reason from the evidence: offers the cart refuses are not 'no market offer'", () => {
    const product = (count: number) => [{ marketCurrencyOffers: { count, ids: [] }, otherCurrencyOffers: 0, evidence: {}, rejected: {} }];
    expect(noOfferReason({ creditsExhausted: false, attemptsAnalyzed: 2, products: product(0) })).toBe("no-market-offer-after-reask");
    expect(noOfferReason({ creditsExhausted: false, attemptsAnalyzed: 2, products: product(1) })).toBe("offers-not-addable");
    expect(noOfferReason({ creditsExhausted: false, attemptsAnalyzed: 1, products: product(0) })).toBe("research-incomplete");
    expect(noOfferReason({ creditsExhausted: true, attemptsAnalyzed: 1, products: [] })).toBe("credits-exhausted");
  });

  it("does not cover A3 whose recorded check shows a JPY merchant offer", () => {
    const blocked = (offers: number): ScenarioRecord => ({ ...record("A3", "BLOCKED"), query: "Q5", blockedReason: "no-market-offer-after-reask", allowance: { id: "A3/Q5", currency: "JPY", marketCurrencyMerchantOffers: offers } });
    const rest = [1, 2, 4, 5, 6, 7, 8].map((n) => record(`A${n}`, "PASS"));
    expect(computeThresholds(input({ scenarios: [blocked(0), ...rest], allowances: [allowance] })).scenariosPassingMet).toBe(true);
    expect(computeThresholds(input({ scenarios: [blocked(1), ...rest], allowances: [allowance] })).scenariosPassingMet).toBe(false);
  });

  it("does not let the allowance cover a failed A3", () => {
    const failedA3 = { ...record("A3", "FAIL"), query: "Q5" };
    const rest = Array.from({ length: 7 }, (_, i) => record(`A${[1, 2, 4, 5, 6, 7, 8][i]}`, "PASS"));
    expect(computeThresholds(input({ scenarios: [failedA3, ...rest], allowances: [allowance] })).scenariosPassingMet).toBe(false);
  });
});

describe("exhausted Exa credits", () => {
  const exhausted = (): ResearchRun => ({
    chunks: [{ type: "data-error", id: "error", data: { kind: "credits_exhausted", message: "Exa reports that credits are exhausted.", partial: false } }],
    requests: 1,
    costDollars: 0.01,
    costKnown: true,
    cacheHits: 0,
  });

  it("stops research at the first credits_exhausted error, blocks the dependent scenarios and ends BLOCKED", async () => {
    const env = dryAcceptanceEnv();
    const asked: string[] = [];
    const log = await run({
      ...env,
      research: async (q) => {
        asked.push(q.id);
        return q.id === "Q3" ? exhausted() : env.research(q);
      },
    });
    expect(asked).toEqual(["Q1", "Q3"]);
    expect(log.exa.perQuery.map((q) => [q.id, q.creditsExhausted])).toEqual([["Q1", false], ["Q3", true], ["Q5", false]]);
    expect(log.exa.perQuery[2]?.notes).toEqual(["not asked: Exa credits are exhausted"]);
    expect(log.scenarios.filter((s) => s.verdict === "BLOCKED").map((s) => s.id)).toEqual(["A2", "A3", "A5"]);
    expect(log.scenarios.filter((s) => s.verdict === "FAIL")).toEqual([]);
    expect(log.verdict).toBe("BLOCKED");
  });

  it("treats an HTTP 402 or a credits_exhausted error body the same way", async () => {
    for (const marker of [{ httpStatus: 402 }, { errorKind: "credits_exhausted" }]) {
      const env = dryAcceptanceEnv();
      const log = await run({ ...env, research: async (q) => (q.id === "Q1" ? { ...failedResearchRun("x"), ...marker } : env.research(q)) });
      expect(log.exa.perQuery[0]?.creditsExhausted).toBe(true);
      expect(log.exa.perQuery.slice(1).every((q) => q.attempts.length === 0)).toBe(true);
      expect(log.scenarios.filter((s) => s.id !== "A6" && s.id !== "A7" && s.id !== "A8").every((s) => s.verdict === "BLOCKED")).toBe(true);
      expect(log.verdict).toBe("BLOCKED");
    }
  });

  it("counts a failed request at the worst case through the env's spend record", async () => {
    const env = dryAcceptanceEnv();
    const spends: { requests: number; costDollars: number }[] = [];
    await run({ ...env, recordExaSpend: (s) => (spends.push(s), env.recordExaSpend(s)), research: async (q) => (q.id === "Q1" ? failedResearchRun("POST /api/chat answered 500", [], 500) : env.research(q)) });
    expect(spends.slice(0, 2)).toEqual([{ requests: 5, costDollars: 0.1 }, { requests: 0, costDollars: 0 }]);
  });

  it("reads the usage and error chunks the way the live stream writes them", () => {
    const chunks = parseSse(`data: ${JSON.stringify({ type: "data-error", id: "error", data: { kind: "credits_exhausted", message: "m", partial: true } })}\n\n`);
    expect(ofType(chunks, "data-error")[0]?.data.kind).toBe("credits_exhausted");
  });
});
