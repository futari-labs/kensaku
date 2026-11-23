// The pure parts of the EV-023 run: the frozen case file, the run log's shape, the thresholds, run numbering, the owner
// audit sheet, and the scan that keeps keys and card numbers out of every file the script writes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Order } from "../../src/core/commerce";
import { holdsKey } from "./sandbox-smoke";
import type { WebhookLogLine } from "./sandbox-smoke";

export const MAX_RUNS = 2;
export const AUDIT_IDS = ["H1", "H2", "H3", "H4", "H5"] as const;
export type AuditId = (typeof AUDIT_IDS)[number];
export type AuditAnswer = "yes" | "no" | "pending";
export type Verdict = "PASS" | "FAIL" | "BLOCKED";

const CaseSchema = z.object({
  queries: z.array(z.object({ id: z.string(), market: z.enum(["US", "SG", "JP"]), currency: z.enum(["USD", "SGD", "JPY"]), text: z.string() })),
  budget: z.object({ exa: z.object({ planWideMaxRequests: z.number(), planWideMaxCostDollars: z.number(), ev023MaxRequests: z.number(), perQuestionCap: z.number() }) }),
  scenarios: z.array(z.object({ id: z.string(), by: z.enum(["owner", "agent"]), query: z.string().optional(), steps: z.string(), expect: z.string() })),
  ownerAudit: z.array(z.string()).length(AUDIT_IDS.length),
});
export type AcceptanceCase = z.infer<typeof CaseSchema>;
export type CaseQuery = AcceptanceCase["queries"][number];

export const REPO_ROOT = join(import.meta.dirname, "../..");
export const EVIDENCE_DIR = join(REPO_ROOT, ".futari/evidence/live");

export const loadCase = (root = REPO_ROOT): AcceptanceCase => CaseSchema.parse(JSON.parse(readFileSync(join(root, "evals/cases/live-acceptance-v1-2.json"), "utf8")));

export interface SessionAudit {
  label: string;
  sessionId: string;
  status: string;
  amountTotal: number | null;
  currency: string | null;
  livemode: boolean;
}

export interface EventRecord {
  eventId: string;
  type: string;
  outcome: string;
  to?: string;
}

export interface ScenarioRecord {
  id: string;
  by: "owner" | "agent";
  query?: string;
  verdict: Verdict;
  orderId?: string;
  sessionId?: string;
  events: EventRecord[];
  transitions: { from: string | null; to: string; at: string }[];
  retrieves: SessionAudit[];
  checks: Record<string, boolean>;
  /** Facts recorded but not gating (for example whether payment_intent.payment_failed arrived). */
  observations: Record<string, unknown>;
  notes: string[];
}

export interface Attempt {
  requests: number;
  costDollars: number;
  cacheHits: number;
}

export interface ResearchRecord {
  id: string;
  market: string;
  currency: string;
  attempts: Attempt[];
  requests: number;
  costDollars: number;
  addableOffers: number;
  chosenOfferId?: string;
  checks: { addableOfferInMarketCurrency: boolean; noBraceInComparisonOrReason: boolean; mainListOnlyMarketCurrency: boolean };
  notes: string[];
}

export interface Thresholds {
  scenariosPassing: number;
  scenariosTotal: number;
  paidWithoutVerifiedEvent: number;
  liveModeObjectsSeen: number;
  duplicatePaidTransitions: number;
  amountMismatches: number;
  stripeChargesOutsideSandbox: number;
  exaWithinBudget: boolean;
  ownerAuditAllYes: boolean | "PENDING";
}

export type RunVerdict = "PASS" | "FAIL" | "PENDING_AUDIT";

export interface RunLog {
  task: "JM-205";
  plan: "kensaku-v1-2";
  evaluation: "EV-023";
  mode: "live" | "dry-run";
  run: number;
  gitSha: string;
  gitDirty: boolean;
  startedAt: string;
  finishedAt: string;
  preconditions: { name: string; ok: boolean; detail: string }[];
  exa: { perQuery: ResearchRecord[]; ev023Requests: number; ev023CostDollars: number; planRequestsAfter: number; caps: { ev023: number; planWide: number; planWideCostDollars: number; perQuery: number } };
  scenarios: ScenarioRecord[];
  researchChecksPass: boolean;
  thresholds: Thresholds;
  ownerAudit: Record<AuditId, AuditAnswer>;
  verdict: RunVerdict;
  notes: string[];
}

const PAID_EVENT_TYPES: ReadonlySet<string> = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

export const isVerifiedPaidLine = (line: WebhookLogLine, orderId: string): boolean =>
  line.orderId === orderId && line.outcome === "applied" && line.to === "paid" && line.type !== undefined && PAID_EVENT_TYPES.has(line.type);

export interface ThresholdInput {
  scenarios: readonly ScenarioRecord[];
  orders: readonly Order[];
  webhook: readonly WebhookLogLine[];
  /** Every order's session, retrieved at the end of the run. */
  sessions: readonly { order: Pick<Order, "orderId" | "currency" | "totalMinor">; session: SessionAudit }[];
  /** Session ids a sandbox account issues: `cs_test_`, or the dry run's fake ids. */
  sandboxSessionId: RegExp;
  exa: { perQueryAttempts: readonly Attempt[]; ev023Requests: number; ev023CostDollars: number; planRequests: number; caps: RunLog["exa"]["caps"] };
  ownerAudit: boolean | "PENDING";
}

export function computeThresholds(input: ThresholdInput): Thresholds {
  const paidTransitions = (order: Order) => order.transitions.filter((t) => t.to === "paid").length;
  const paid = input.orders.filter((o) => paidTransitions(o) > 0);
  const { caps } = input.exa;
  const { exa } = input;
  return {
    scenariosPassing: input.scenarios.filter((s) => s.verdict === "PASS").length,
    scenariosTotal: input.scenarios.length,
    paidWithoutVerifiedEvent: paid.filter((o) => !input.webhook.some((line) => isVerifiedPaidLine(line, o.orderId))).length,
    liveModeObjectsSeen: input.sessions.filter((s) => s.session.livemode).length + input.webhook.filter((l) => l.outcome === "rejected-livemode").length,
    duplicatePaidTransitions: input.orders.reduce((n, o) => n + Math.max(0, paidTransitions(o) - 1), 0),
    amountMismatches: input.sessions.filter(({ order, session }) => session.amountTotal !== order.totalMinor || session.currency !== order.currency.toLowerCase()).length,
    stripeChargesOutsideSandbox: input.sessions.filter(({ session }) => session.livemode || !input.sandboxSessionId.test(session.sessionId)).length,
    exaWithinBudget:
      exa.perQueryAttempts.every((a) => a.requests <= caps.perQuery) && exa.ev023Requests <= caps.ev023 && exa.planRequests <= caps.planWide && exa.ev023CostDollars <= caps.planWideCostDollars,
    ownerAuditAllYes: input.ownerAudit,
  };
}

export function runVerdict(t: Thresholds, researchChecksPass: boolean): RunVerdict {
  const gated =
    researchChecksPass &&
    t.scenariosPassing === t.scenariosTotal &&
    t.paidWithoutVerifiedEvent === 0 &&
    t.liveModeObjectsSeen === 0 &&
    t.duplicatePaidTransitions === 0 &&
    t.amountMismatches === 0 &&
    t.stripeChargesOutsideSandbox === 0 &&
    t.exaWithinBudget;
  if (!gated || t.ownerAuditAllYes === false) return "FAIL";
  return t.ownerAuditAllYes === "PENDING" ? "PENDING_AUDIT" : "PASS";
}

const RUN_LOG_NAME = /^ev-023-run-(\d+)-\d{8}T\d{6}Z\.json$/;

export class RunLimitError extends Error {}

/** The next run's number from the log files already in the evidence folder; a third run is refused. */
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

export const auditFileName = (run: number): string => `ev-023-run-${run}-audit.md`;

export function renderAuditTemplate(args: { run: number; logFile: string; gitSha: string; questions: readonly string[] }): string {
  return [
    `# EV-023 run ${args.run} owner audit`,
    "",
    `Run log: .futari/evidence/live/${args.logFile} (git ${args.gitSha}).`,
    "",
    "The coordinator records the owner's answers below, from what the owner saw on the Stripe-hosted pages (A1-A5) and in Kensaku. Write `yes` or `no` after `Answer:`, then any note. An empty answer counts as pending, never as yes.",
    "",
    ...args.questions.flatMap((question, i) => [`## ${AUDIT_IDS[i]}`, "", `Question: ${question}`, "Answer:", "Note:", ""]),
  ].join("\n");
}

export function parseAudit(text: string): Record<AuditId, AuditAnswer> {
  const answers = Object.fromEntries(AUDIT_IDS.map((id) => [id, "pending"])) as Record<AuditId, AuditAnswer>;
  for (const section of text.split(/^## /m).slice(1)) {
    const id = AUDIT_IDS.find((candidate) => section.startsWith(candidate));
    const answer = /^Answer:[ \t]*(.*)$/m.exec(section)?.[1]?.trim().toLowerCase() ?? "";
    if (id && /^(yes|no)\b/.test(answer)) answers[id] = answer.startsWith("yes") ? "yes" : "no";
  }
  return answers;
}

export function auditAllYes(answers: Record<AuditId, AuditAnswer>): boolean | "PENDING" {
  const values = Object.values(answers);
  if (values.includes("no")) return false;
  return values.every((a) => a === "yes") ? true : "PENDING";
}

const CARD_RUN = /\b\d(?:[ -]?\d){12,18}\b/g;
const ORDER_ID = /ord_[0-9a-f-]+/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  [...digits].reverse().forEach((ch, i) => {
    let d = Number(ch);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  });
  return sum % 10 === 0;
}

/** Why a file must not be written: a key-shaped value or a number that is a valid card number. Empty means clean. */
export function leakProblems(text: string): string[] {
  const problems: string[] = [];
  if (holdsKey(text)) problems.push("a key or signing secret");
  const withoutIds = text.replace(ORDER_ID, "ord");
  for (const match of withoutIds.matchAll(CARD_RUN)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) problems.push("a full card number");
  }
  return problems;
}
