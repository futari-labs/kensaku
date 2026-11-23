import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Order } from "../../src/core/commerce";
import { holdsKey, redact } from "./sandbox-smoke";
import type { WebhookLogLine } from "./sandbox-smoke";

export const MAX_RUNS = 2;
export const AUDIT_IDS = ["H1", "H2", "H3", "H4", "H5"] as const;
export type AuditId = (typeof AUDIT_IDS)[number];
export type AuditAnswer = "yes" | "no" | "pending";

export const SCENARIO_IDS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

const EXPECTED_SCENARIOS: Record<ScenarioId, { by: "owner" | "agent"; query?: string }> = {
  A1: { by: "owner", query: "Q1" },
  A2: { by: "owner", query: "Q3" },
  A3: { by: "owner", query: "Q5" },
  A4: { by: "owner", query: "Q1" },
  A5: { by: "owner", query: "Q3" },
  A6: { by: "agent" },
  A7: { by: "agent" },
  A8: { by: "agent" },
};

const EXPECTED_QUERIES = [
  { id: "Q1", market: "US", currency: "USD" },
  { id: "Q3", market: "SG", currency: "SGD" },
  { id: "Q5", market: "JP", currency: "JPY" },
] as const;

const CaseSchema = z.object({
  queries: z.array(z.object({ id: z.string(), market: z.enum(["US", "SG", "JP"]), currency: z.enum(["USD", "SGD", "JPY"]), text: z.string() })),
  budget: z.object({ exa: z.object({ planWideMaxRequests: z.number(), planWideMaxCostDollars: z.number(), ev023MaxRequests: z.number(), perQuestionCap: z.number() }) }),
  scenarios: z.array(z.object({ id: z.enum(SCENARIO_IDS), by: z.enum(["owner", "agent"]), query: z.string().optional(), steps: z.string(), expect: z.string() })),
  /** CR-006: a scenario that may be BLOCKED without failing the scenarios threshold. Absent in case files that predate it. */
  blockedAllowances: z.array(z.object({ scenario: z.enum(SCENARIO_IDS), query: z.string(), when: z.string() })).default([]),
  ownerAudit: z.array(z.string()).length(AUDIT_IDS.length),
});
export type AcceptanceCase = z.infer<typeof CaseSchema>;
export type CaseQuery = AcceptanceCase["queries"][number];
export type CaseScenario = AcceptanceCase["scenarios"][number];
export type BlockedAllowance = AcceptanceCase["blockedAllowances"][number];

export const REPO_ROOT = join(import.meta.dirname, "../..");
export const EVIDENCE_DIR = join(REPO_ROOT, ".futari/evidence/live");

export function checkCaseShape(c: AcceptanceCase): AcceptanceCase {
  const ids = c.scenarios.map((s) => s.id);
  if (ids.length !== SCENARIO_IDS.length || SCENARIO_IDS.some((id) => !ids.includes(id))) throw new Error(`the case file must hold exactly the scenarios ${SCENARIO_IDS.join(", ")}; it holds ${ids.join(", ")}`);
  for (const s of c.scenarios) {
    const expected = EXPECTED_SCENARIOS[s.id];
    if (s.by !== expected.by || s.query !== expected.query) throw new Error(`scenario ${s.id} must be by ${expected.by} on ${expected.query ?? "no query"}; the case file says by ${s.by} on ${s.query ?? "no query"}`);
  }
  for (const expected of EXPECTED_QUERIES) {
    const q = c.queries.find((candidate) => candidate.id === expected.id);
    if (q?.market !== expected.market || q.currency !== expected.currency) throw new Error(`query ${expected.id} must be market ${expected.market} in ${expected.currency}`);
  }
  return c;
}

export const loadCase = (root = REPO_ROOT): AcceptanceCase => checkCaseShape(CaseSchema.parse(JSON.parse(readFileSync(join(root, "evals/cases/live-acceptance-v1-2.json"), "utf8"))));

const ScenarioVerdictSchema = z.enum(["PASS", "FAIL", "BLOCKED"]);
export type Verdict = z.infer<typeof ScenarioVerdictSchema>;

const SessionAuditSchema = z.object({
  label: z.string(),
  sessionId: z.string(),
  status: z.string(),
  amountTotal: z.number().nullable(),
  currency: z.string().nullable(),
  livemode: z.boolean(),
});
export type SessionAudit = z.infer<typeof SessionAuditSchema>;

const EventRecordSchema = z.object({ eventId: z.string(), type: z.string(), outcome: z.string(), to: z.string().optional() });
export type EventRecord = z.infer<typeof EventRecordSchema>;

/**
 * Why a scenario is BLOCKED, so a blockedAllowance is judged on evidence. Only `no-market-offer-after-reask` can be covered:
 * research finished both permitted asks and the last one's validated data holds no merchant offer in the market currency at all.
 * `offers-not-addable` is the same run with offers present that the cart refuses (out of stock, below the minimum): a defect to look at, not an allowance.
 */
export const BLOCKED_REASONS = ["no-market-offer-after-reask", "offers-not-addable", "credits-exhausted", "research-incomplete", "missing-prerequisite"] as const;
export type BlockedReason = (typeof BLOCKED_REASONS)[number];

const ScenarioRecordSchema = z.object({
  id: z.string(),
  by: z.enum(["owner", "agent"]),
  query: z.string().optional(),
  verdict: ScenarioVerdictSchema,
  blockedReason: z.enum(BLOCKED_REASONS).optional(),
  /** Set with `blockedReason` when research left the scenario without an offer: the query's market-currency merchant offer count from the validated data, ids and counts only. */
  allowance: z.object({ id: z.string(), currency: z.string(), marketCurrencyMerchantOffers: z.number() }).optional(),
  orderId: z.string().optional(),
  sessionId: z.string().optional(),
  events: z.array(EventRecordSchema),
  transitions: z.array(z.object({ from: z.string().nullable(), to: z.string(), at: z.string() })),
  retrieves: z.array(SessionAuditSchema),
  checks: z.record(z.string(), z.boolean()),
  observations: z.record(z.string(), z.unknown()),
  notes: z.array(z.string()),
});
export type ScenarioRecord = z.infer<typeof ScenarioRecordSchema>;

const AttemptSchema = z.object({ requests: z.number(), costDollars: z.number(), costKnown: z.boolean(), cacheHits: z.number() });
export type Attempt = z.infer<typeof AttemptSchema>;

const ResearchChecksSchema = z.object({ addableOfferInMarketCurrency: z.boolean(), noBraceInComparisonOrReason: z.boolean(), mainListOnlyMarketCurrency: z.boolean() });

/** One product's validated outcome from the stream's data-products: ids, counts and categories only, never a URL, title or free text. */
const ProductSummarySchema = z.object({
  marketCurrencyOffers: z.object({ count: z.number(), ids: z.array(z.string()) }),
  otherCurrencyOffers: z.number(),
  evidence: z.record(z.string(), z.number()),
  rejected: z.record(z.string(), z.number()),
});
export type ProductSummary = z.infer<typeof ProductSummarySchema>;

const ResearchRecordSchema = z.object({
  id: z.string(),
  market: z.string(),
  currency: z.string(),
  attempts: z.array(AttemptSchema),
  attemptsAnalyzed: z.number(),
  requests: z.number(),
  costDollars: z.number(),
  addableOffers: z.number(),
  /** The products of the last analyzed attempt (the cached or fresh data the allowance is judged on). */
  products: z.array(ProductSummarySchema),
  chosenOfferId: z.string().optional(),
  creditsExhausted: z.boolean(),
  /** Set when research kept failing for a reason other than exhausted credits or a budget refusal: a defect, so the run is FAIL. */
  researchError: z.string().optional(),
  checks: ResearchChecksSchema,
  notes: z.array(z.string()),
});
export type ResearchRecord = z.infer<typeof ResearchRecordSchema>;

const ThresholdsSchema = z.object({
  scenariosPassing: z.number(),
  scenariosTotal: z.number(),
  /** All scenarios PASS, or every one that does not is BLOCKED and covered by a blockedAllowance (CR-006). */
  scenariosPassingMet: z.boolean(),
  /** The allowances that covered a BLOCKED scenario, as `<scenario>/<query>`. */
  blockedAllowancesUsed: z.array(z.string()),
  paidWithoutVerifiedEvent: z.number(),
  liveModeObjectsSeen: z.number(),
  duplicatePaidTransitions: z.number(),
  amountMismatches: z.number(),
  stripeChargesOutsideSandbox: z.number(),
  exaWithinBudget: z.boolean(),
  ownerAuditAllYes: z.union([z.boolean(), z.literal("PENDING")]),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;

const RunVerdictSchema = z.enum(["PASS", "FAIL", "BLOCKED", "PENDING_AUDIT"]);
export type RunVerdict = z.infer<typeof RunVerdictSchema>;

const AuditAnswerSchema = z.enum(["yes", "no", "pending"]);
const CapsSchema = z.object({ ev023: z.number(), planWide: z.number(), planWideCostDollars: z.number(), perQuery: z.number() });

export const RunLogSchema = z.object({
  task: z.literal("JM-205"),
  plan: z.literal("kensaku-v1-2"),
  evaluation: z.literal("EV-023"),
  status: z.enum(["complete", "aborted"]),
  mode: z.enum(["live", "dry-run"]),
  run: z.number(),
  gitSha: z.string(),
  gitDirty: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string(),
  preconditions: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })),
  exa: z.object({
    perQuery: z.array(ResearchRecordSchema),
    ev023Requests: z.number(),
    ev023CostDollars: z.number(),
    planRequestsAfter: z.number(),
    planCostDollarsAfter: z.number(),
    caps: CapsSchema,
  }),
  scenarios: z.array(ScenarioRecordSchema),
  researchChecksPass: z.boolean(),
  thresholds: ThresholdsSchema,
  ownerAudit: z.object({ H1: AuditAnswerSchema, H2: AuditAnswerSchema, H3: AuditAnswerSchema, H4: AuditAnswerSchema, H5: AuditAnswerSchema }),
  verdict: RunVerdictSchema,
  notes: z.array(z.string()),
});
export type RunLog = z.infer<typeof RunLogSchema>;

export const parseRunLog = (text: string): RunLog => RunLogSchema.parse(JSON.parse(text));

export interface RunStub {
  task: "JM-205";
  plan: "kensaku-v1-2";
  evaluation: "EV-023";
  status: "started";
  mode: RunLog["mode"];
  run: number;
  gitSha: string;
  startedAt: string;
  /** This run's Exa spend so far, an attempt's worst case included while it is in flight, so evidence recovery counts an interrupted attempt. */
  exa: { ev023Requests: number; ev023CostDollars: number };
  notes: string[];
}

export const renderStub = (stub: Omit<RunStub, "task" | "plan" | "evaluation" | "status" | "notes">): string =>
  `${JSON.stringify({ task: "JM-205", plan: "kensaku-v1-2", evaluation: "EV-023", status: "started", ...stub, notes: ["reserved before any Exa request; replaced by the run's log when the run ends"] } satisfies RunStub, null, 2)}\n`;

const PAID_EVENT_TYPES: ReadonlySet<string> = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

export const isVerifiedPaidLine = (line: WebhookLogLine, orderId: string): boolean =>
  line.orderId === orderId && line.outcome === "applied" && line.to === "paid" && line.type !== undefined && PAID_EVENT_TYPES.has(line.type);

export interface ThresholdInput {
  scenarios: readonly ScenarioRecord[];
  scenariosTotal: number;
  allowances: readonly BlockedAllowance[];
  orders: readonly Order[];
  webhook: readonly WebhookLogLine[];
  sessions: readonly { order: Pick<Order, "orderId" | "currency" | "totalMinor">; session: SessionAudit }[];
  sandboxSessionId: RegExp;
  exa: { perQueryAttempts: readonly Attempt[]; ev023Requests: number; planRequests: number; planCostDollars: number; caps: z.infer<typeof CapsSchema> };
  ownerAudit: boolean | "PENDING";
}

export function computeThresholds(input: ThresholdInput): Thresholds {
  const paidTransitions = (order: Order) => order.transitions.filter((t) => t.to === "paid").length;
  const paid = input.orders.filter((o) => paidTransitions(o) > 0);
  const { exa } = input;
  const notPassing = input.scenarios.filter((s) => s.verdict !== "PASS");
  const covering = (s: ScenarioRecord) =>
    input.allowances.find((a) => a.scenario === s.id && a.query === s.query && s.verdict === "BLOCKED" && s.blockedReason === "no-market-offer-after-reask" && s.allowance?.id === `${a.scenario}/${a.query}` && s.allowance.marketCurrencyMerchantOffers === 0);
  const covered = notPassing.flatMap((s) => covering(s) ?? []);
  return {
    scenariosPassing: input.scenarios.filter((s) => s.verdict === "PASS").length,
    scenariosTotal: input.scenariosTotal,
    scenariosPassingMet: input.scenariosTotal > 0 && input.scenarios.length === input.scenariosTotal && covered.length === notPassing.length,
    blockedAllowancesUsed: covered.map((a) => `${a.scenario}/${a.query}`),
    paidWithoutVerifiedEvent: paid.filter((o) => !input.webhook.some((line) => isVerifiedPaidLine(line, o.orderId))).length,
    liveModeObjectsSeen: input.sessions.filter((s) => s.session.livemode).length + input.webhook.filter((l) => l.outcome === "rejected-livemode").length,
    duplicatePaidTransitions: input.orders.reduce((n, o) => n + Math.max(0, paidTransitions(o) - 1), 0),
    amountMismatches: input.sessions.filter(({ order, session }) => session.amountTotal !== order.totalMinor || session.currency !== order.currency.toLowerCase()).length,
    stripeChargesOutsideSandbox: input.sessions.filter(({ session }) => session.livemode || !input.sandboxSessionId.test(session.sessionId)).length,
    exaWithinBudget:
      exa.perQueryAttempts.every((a) => a.requests <= exa.caps.perQuery) &&
      exa.ev023Requests <= exa.caps.ev023 &&
      exa.planRequests <= exa.caps.planWide &&
      exa.planCostDollars <= exa.caps.planWideCostDollars,
    ownerAuditAllYes: input.ownerAudit,
  };
}

export function runVerdict(t: Thresholds, researchChecksPass: boolean, blockedScenarios: number): RunVerdict {
  const failed =
    !researchChecksPass ||
    t.scenariosTotal === 0 ||
    t.scenariosPassing + blockedScenarios !== t.scenariosTotal ||
    t.paidWithoutVerifiedEvent !== 0 ||
    t.liveModeObjectsSeen !== 0 ||
    t.duplicatePaidTransitions !== 0 ||
    t.amountMismatches !== 0 ||
    t.stripeChargesOutsideSandbox !== 0 ||
    !t.exaWithinBudget ||
    t.ownerAuditAllYes === false;
  if (failed) return "FAIL";
  if (!t.scenariosPassingMet) return "BLOCKED";
  return t.ownerAuditAllYes === "PENDING" ? "PENDING_AUDIT" : "PASS";
}

export function withOwnerAudit(log: RunLog, answers: Record<AuditId, AuditAnswer>): RunLog {
  if (log.status !== "complete") throw new Error(`run ${log.run} ended with status ${log.status}; its owner audit cannot be recorded`);
  const thresholds = { ...log.thresholds, ownerAuditAllYes: auditAllYes(answers) };
  const blocked = log.scenarios.filter((s) => s.verdict === "BLOCKED").length;
  return { ...log, ownerAudit: answers, thresholds, verdict: runVerdict(thresholds, log.researchChecksPass, blocked) };
}

const RUN_LOG_NAME = /^ev-023-run-(\d+)-\d{8}T\d{6}Z\.json$/;

export class RunLimitError extends Error {}

export function nextRunNumber(files: readonly string[]): number {
  const used = files.flatMap((f) => RUN_LOG_NAME.exec(f)?.[1] ?? []).map(Number);
  const next = Math.max(0, ...used) + 1;
  if (next > MAX_RUNS) throw new RunLimitError(`EV-023 allows at most ${MAX_RUNS} runs and ${used.length} run log(s) exist in .futari/evidence/live/.`);
  return next;
}

export const runNumberOfLog = (file: string): number | undefined => {
  const match = RUN_LOG_NAME.exec(file.split("/").at(-1) ?? "");
  return match ? Number(match[1]) : undefined;
};

export const logFileName = (run: number, startedAt: string): string => `ev-023-run-${run}-${startedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.json`;

export const auditFileName = (run: number): string => `ev-023-run-${run}-audit.md`;

export function renderAuditTemplate(args: { run: number; logFile: string; gitSha: string; questions: readonly string[] }): string {
  return [
    `# EV-023 run ${args.run} owner audit`,
    "",
    `Run log: .futari/evidence/live/${args.logFile} (git ${args.gitSha}).`,
    "",
    "The coordinator records the owner's answers below, from what the owner saw on the Stripe-hosted pages (A1-A5) and in Kensaku. Write exactly `yes` or `no` after `Answer:` and put any note on the `Note:` line. Anything else, including an empty answer, counts as pending, never as yes.",
    "",
    ...args.questions.flatMap((question, i) => [`## ${AUDIT_IDS[i]}`, "", `Question: ${question}`, "Answer:", "Note:", ""]),
  ].join("\n");
}

export function parseAudit(text: string): Record<AuditId, AuditAnswer> {
  const answers = Object.fromEntries(AUDIT_IDS.map((id) => [id, "pending"])) as Record<AuditId, AuditAnswer>;
  for (const section of text.split(/^## /m).slice(1)) {
    const id = AUDIT_IDS.find((candidate) => section.startsWith(candidate));
    const answer = /^Answer:[ \t]*(.*)$/m.exec(section)?.[1]?.trim().toLowerCase() ?? "";
    const exact = /^(yes|no)[.!]*$/.exec(answer)?.[1];
    if (id && (exact === "yes" || exact === "no")) answers[id] = exact;
  }
  return answers;
}

export function auditAllYes(answers: Record<AuditId, AuditAnswer>): boolean | "PENDING" {
  const values = Object.values(answers);
  if (values.includes("no")) return false;
  return values.every((a) => a === "yes") ? true : "PENDING";
}

const CARD_RUN = /\b\d(?:[ .-]?\d){12,18}\b/g;
const ORDER_ID = /ord_[0-9a-f-]+/g;
// One whole numeric token: not glued to dotted digit groups ("4242.4242.4242.4242") or to a spaced group ("1.4242 4242 4242 4242").
const DECIMAL_NUMBER = /(?<![\d.][ -]?)(?<![\w.])-?\d+\.\d+(?:[eE][+-]?\d+)?(?!\w|\.\d|[ -]\d)/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  [...digits].reverse().forEach((ch, i) => {
    let d = Number(ch);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  });
  return sum % 10 === 0;
}

/** Any 13 to 19 digit stretch of the run passes the Luhn check, so a stray digit group beside a card number cannot hide it. */
function anyLuhnWindow(digits: string): boolean {
  for (let length = 13; length <= Math.min(19, digits.length); length++) {
    for (let start = 0; start + length <= digits.length; start++) if (luhnValid(digits.slice(start, start + length))) return true;
  }
  return false;
}

export function leakProblems(text: string): string[] {
  const problems: string[] = [];
  if (holdsKey(text)) problems.push("a key or signing secret");
  const withoutBenign = text.replace(ORDER_ID, "ord").replace(DECIMAL_NUMBER, "num");
  for (const match of withoutBenign.matchAll(CARD_RUN)) {
    const digits = match[0].replace(/\D/g, "");
    if (anyLuhnWindow(digits)) problems.push("a full card number");
  }
  return problems;
}

const scrubJson = (value: unknown): unknown => {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(scrubJson);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubJson(v)]));
  return value;
};

export function safeLogText(log: RunLog): string {
  const plain = `${JSON.stringify(log, null, 2)}\n`;
  const problems = leakProblems(plain);
  if (problems.length === 0) return plain;
  const note = `the leak scan found ${problems.join(" and ")} in this log; every string was scrubbed before writing`;
  const clean = scrubJson(log) as RunLog;
  const scrubbed = `${JSON.stringify({ ...clean, notes: [...clean.notes, note] }, null, 2)}\n`;
  if (leakProblems(scrubbed).length === 0) return scrubbed;
  const { run, mode, gitSha, startedAt, finishedAt, verdict } = log;
  return `${JSON.stringify({ task: log.task, plan: log.plan, evaluation: log.evaluation, status: "aborted", run, mode, gitSha, startedAt, finishedAt, verdict, exa: { ev023Requests: log.exa.ev023Requests, ev023CostDollars: log.exa.ev023CostDollars }, notes: [...log.notes.map((n) => redact(n)), `${note}; the scrubbed log still matched, so only this summary was kept`] }, null, 2)}\n`;
}
