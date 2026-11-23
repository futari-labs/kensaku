import { randomBytes } from "node:crypto";
import { z } from "zod";
import { CheckoutPortError } from "../../src/commerce/port";
import type { CheckoutPort } from "../../src/commerce/port";
import { signTestPayload, stripeEventEnvelope } from "../../src/commerce/stripe-port";
import { formatMinor, toMinorUnits, toRegisteredOffer } from "../../src/core/commerce";
import type { Cart, CartLine, Order, RegisteredOffer } from "../../src/core/commerce";
import type { Market } from "../../src/core/types";
import { buyBlock, offerView } from "../../src/web/app/offers";
import { ofType } from "../../tests/server/sse";
import type { Chunk } from "../../tests/server/sse";
import { computeThresholds, isVerifiedPaidLine, runVerdict } from "./acceptance-log";
import type { AcceptanceCase, Attempt, CaseQuery, CaseScenario, EventRecord, ResearchRecord, RunLog, ScenarioId, ScenarioRecord, SessionAudit } from "./acceptance-log";
import { RUN_EXA_MAX, round6, WORST_CASE_ATTEMPT_COST_DOLLARS } from "./exa-counter";
import type { PlanUsage } from "./exa-counter";
import { redact, SmokeAbort } from "./sandbox-smoke";
import type { WebhookLogLine } from "./sandbox-smoke";

export class AcceptanceAbort extends SmokeAbort {}

export interface Precondition {
  name: string;
  ok: boolean;
  detail: string;
}

const HostedPageUrlSchema = z.string().min(1).brand<"HostedPageUrl">();
export type HostedPageUrl = z.infer<typeof HostedPageUrlSchema>;
const CheckoutStartedSchema = z.object({ orderId: z.string(), url: HostedPageUrlSchema });

export interface AcceptanceStep {
  id: ScenarioId;
  action: "pay" | "decline" | "back";
  orderId: string;
  url: HostedPageUrl;
  steps: string;
  expect: string;
  demoTotal: string;
}

export interface ResearchRun {
  chunks: Chunk[];
  requests: number;
  costDollars: number;
  costKnown: boolean;
  cacheHits: number;
  httpStatus?: number;
  errorKind?: string;
  failure?: string;
}

export interface Spend {
  requests: number;
  costDollars: number;
}

export interface AcceptanceEnv {
  mode: "live" | "dry-run";
  port: CheckoutPort;
  api(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  webhook(rawBody: string, signature?: string): Promise<number>;
  preconditions(): Promise<Precondition[]>;
  planUsage(): PlanUsage;
  exaRefusal(): string | undefined;
  recordExaSpend(spend: Spend): void;
  research(query: CaseQuery): Promise<ResearchRun>;
  ownerStep(step: AcceptanceStep, done: () => Promise<boolean>): Promise<boolean>;
  resend(eventId: string): Promise<{ exitCode: number | null; output: string }>;
  webhookLog(): Promise<WebhookLogLine[]>;
  now(): Date;
  sleep(ms: number): Promise<void>;
  gitSha(): string;
  gitDirty(): boolean;
  say(line: string): void;
  sandboxSessionId: RegExp;
}

export function usageOfChunks(chunks: readonly Chunk[]): Pick<ResearchRun, "requests" | "costDollars" | "costKnown" | "cacheHits"> {
  const usage = ofType([...chunks], "data-usage")[0]?.data;
  const costKnown = typeof usage?.costDollars === "number";
  return {
    requests: typeof usage?.exaRequests === "number" ? usage.exaRequests : RUN_EXA_MAX,
    costDollars: costKnown ? round6(usage.costDollars) : WORST_CASE_ATTEMPT_COST_DOLLARS,
    costKnown,
    cacheHits: typeof usage?.cacheHits === "number" ? usage.cacheHits : 0,
  };
}

export const failedResearchRun = (failure: string, chunks: Chunk[] = [], httpStatus?: number): ResearchRun => ({
  chunks,
  ...usageOfChunks(chunks),
  ...(httpStatus !== undefined && { httpStatus }),
  failure,
});

export interface ResearchAnalysis {
  addable: RegisteredOffer[];
  braces: string[];
  mainListOnlyMarketCurrency: boolean;
}

export function analyzeResearch(chunks: readonly Chunk[], query: Pick<CaseQuery, "market" | "currency">, at: string): ResearchAnalysis {
  const products = ofType([...chunks], "data-products").at(-1)?.data ?? [];
  const market: Market = query.market;
  const views = products.map((p) => offerView(p, market));
  const mainList = views.flatMap((v) => (v.kind === "offers" ? v.local : []));
  const comparison = ofType([...chunks], "text-delta").map((c) => c.delta).join("");
  const braces = [
    ...(/[{}]/.test(comparison) ? ["comparison"] : []),
    ...products.flatMap((p, i) => (p.reason?.renderedText && /[{}]/.test(p.reason.renderedText) ? [`reason of card ${i + 1}`] : [])),
  ];
  return {
    addable: mainList.filter((o) => buyBlock(o, undefined) === undefined).flatMap((o) => toRegisteredOffer(o, market, at) ?? []),
    braces,
    mainListOnlyMarketCurrency: mainList.every((o) => o.price.currency === query.currency),
  };
}

const lowerCurrency = (order: Pick<Order, "currency">) => order.currency.toLowerCase();

async function retrieve(env: AcceptanceEnv, label: string, sessionId: string): Promise<SessionAudit> {
  try {
    const s = await env.port.retrieveSession(sessionId);
    return { label, sessionId, status: s.status, amountTotal: s.amountTotal, currency: s.currency, livemode: s.livemode };
  } catch (error) {
    const refusedLive = error instanceof CheckoutPortError && error.code === "livemode-refused";
    return { label, sessionId, status: refusedLive ? "livemode-refused" : "unretrievable", amountTotal: null, currency: null, livemode: refusedLive };
  }
}

const orderOf = async (env: AcceptanceEnv, id: string): Promise<Order | undefined> => {
  const reply = await env.api("GET", `/api/orders/${id}`);
  return reply.status === 200 ? (reply.body as { order: Order }).order : undefined;
};

const allOrders = async (env: AcceptanceEnv): Promise<Order[]> => ((await env.api("GET", "/api/orders")).body as { orders: Order[] }).orders;
const cartOf = async (env: AcceptanceEnv): Promise<{ cart: Cart; totalMinor: number }> => (await env.api("GET", "/api/cart")).body as { cart: Cart; totalMinor: number };
const sameLines = (a: readonly CartLine[], b: readonly CartLine[]): boolean => JSON.stringify(a) === JSON.stringify(b);

function eventsOf(log: readonly WebhookLogLine[], orderId: string): EventRecord[] {
  const own = new Set(log.flatMap((l) => (l.orderId === orderId && l.eventId ? [l.eventId] : [])));
  return log.flatMap((l) => (l.eventId !== undefined && own.has(l.eventId) ? [{ eventId: l.eventId, type: l.type ?? "", outcome: l.outcome ?? "", ...(l.to && { to: l.to }) }] : []));
}

const transitionsOf = (order: Order | undefined) => (order?.transitions ?? []).map((t) => ({ from: t.from, to: t.to, at: t.at }));
const paidCount = (order: Order | undefined) => (order?.transitions ?? []).filter((t) => t.to === "paid").length;
const duplicateLines = (log: readonly WebhookLogLine[], eventId: string) => log.filter((l) => l.eventId === eventId && l.outcome === "duplicate").length;

async function pollWebhookLog(env: AcceptanceEnv, enough: (log: WebhookLogLine[]) => boolean, polls: number, everyMs: number): Promise<WebhookLogLine[]> {
  let log = await env.webhookLog();
  for (let i = 0; i < polls && !enough(log); i++) {
    await env.sleep(everyMs);
    log = await env.webhookLog();
  }
  return log;
}

export const PAY_CHECKS = [
  "ownerCompletedStep",
  "orderFound",
  "orderPaid",
  "paidByVerifiedCompletedEvent",
  "exactlyOnePaidTransition",
  "sessionCompleteWithDemoTotal",
  "sessionAmountEqualsObservedOffer",
  "sessionCurrencyMatches",
  "cartCleared",
] as const;
export const CANCEL_CHECKS = ["ownerCompletedStep", "orderFound", "orderCancelled", "neverPaid", "sessionExpired", "cartUnchanged"] as const;
export const A6_CHECKS = ["resendExitedZero", "duplicateLineAddedOnce", "serverAnsweredDuplicate", "exactlyOnePaidTransition", "noOtherOrderChanged"] as const;
export const A7_CHECKS = [
  "firstCheckoutStarted",
  "secondCheckoutStarted",
  "firstOrderSuperseded",
  "firstSessionExpired",
  "secondOrderOpen",
  "cancelAnswered200",
  "secondOrderCancelled",
  "secondSessionExpired",
] as const;
export const A8_CHECKS = ["unsignedRejected400", "wrongSecretRejected400", "orderStillCancelled"] as const;

interface Spec {
  id: string;
  by: "owner" | "agent";
  query?: string;
}

export async function scenario(spec: Spec, required: readonly string[], body: (rec: ScenarioRecord) => Promise<void>): Promise<ScenarioRecord> {
  const rec: ScenarioRecord = {
    ...spec,
    verdict: "FAIL",
    events: [],
    transitions: [],
    retrieves: [],
    checks: Object.fromEntries(required.map((name) => [name, false])),
    observations: {},
    notes: [],
  };
  let threw = false;
  try {
    await body(rec);
  } catch (error) {
    threw = true;
    rec.notes.push(`stopped by an error: ${redact(error instanceof Error ? error.message : String(error))}`);
  }
  if (threw) rec.verdict = "FAIL";
  else if (rec.verdict !== "BLOCKED") rec.verdict = required.length > 0 && required.every((name) => rec.checks[name] === true) ? "PASS" : "FAIL";
  return rec;
}

const block = (rec: ScenarioRecord, reason: string) => {
  rec.verdict = "BLOCKED";
  rec.notes.push(`BLOCKED: ${reason}`);
};

async function ensureEmptyCart(env: AcceptanceEnv): Promise<void> {
  if ((await cartOf(env)).cart.lines.length > 0) await env.api("DELETE", "/api/cart");
}

async function startCheckout(env: AcceptanceEnv, rec: ScenarioRecord, offer: RegisteredOffer): Promise<{ orderId: string; url: HostedPageUrl } | undefined> {
  await ensureEmptyCart(env);
  const added = await env.api("POST", "/api/cart/items", { offerId: offer.id });
  if (added.status !== 200) {
    rec.notes.push(`adding the ${offer.price.currency} offer to the cart answered ${added.status}: ${JSON.stringify(added.body)}`);
    return undefined;
  }
  const started = await env.api("POST", "/api/checkout", {});
  const parsed = started.status === 200 ? CheckoutStartedSchema.safeParse(started.body) : undefined;
  if (!parsed?.success) {
    rec.notes.push(`checkout answered ${started.status} without an order id and a page URL`);
    return undefined;
  }
  return parsed.data;
}

interface Context {
  env: AcceptanceEnv;
  offers: ReadonlyMap<string, RegisteredOffer | undefined>;
  records: ReadonlyMap<ScenarioId, ScenarioRecord>;
}

type Runner = (ctx: Context, def: CaseScenario) => Promise<ScenarioRecord>;

const ownerRunner =
  (action: AcceptanceStep["action"]): Runner =>
  ({ env, offers }, def) =>
    scenario({ id: def.id, by: "owner", ...(def.query !== undefined && { query: def.query }) }, action === "pay" ? PAY_CHECKS : CANCEL_CHECKS, async (rec) => {
      if (def.query === undefined) throw new Error(`${def.id} names no research query`);
      const offer = offers.get(def.query);
      if (!offer) return block(rec, `no addable offer for ${def.query}`);
      const started = await startCheckout(env, rec, offer);
      if (!started) return;
      const before = await cartOf(env);
      rec.orderId = started.orderId;
      const completed = await env.ownerStep(
        { id: def.id, action, orderId: started.orderId, url: started.url, steps: def.steps, expect: def.expect, demoTotal: `${formatMinor(before.totalMinor, offer.price.currency)} ${offer.price.currency}` },
        async () => ((await orderOf(env, started.orderId))?.state ?? "open") !== "open",
      );
      rec.checks.ownerCompletedStep = completed;
      if (!completed) {
        rec.notes.push(`${def.id}: the owner step did not finish before the timeout`);
        await env.api("POST", `/api/orders/${started.orderId}/cancel`, {});
      }
      const order = await orderOf(env, started.orderId);
      rec.checks.orderFound = order !== undefined;
      const log = action === "pay" ? await pollWebhookLog(env, (l) => l.some((x) => isVerifiedPaidLine(x, started.orderId)), 5, 2_000) : await env.webhookLog();
      const cart = await cartOf(env);
      rec.sessionId = order?.stripeSessionId ?? undefined;
      rec.events = eventsOf(log, started.orderId);
      rec.transitions = transitionsOf(order);
      const session = order?.stripeSessionId ? await retrieve(env, "audit after the owner step", order.stripeSessionId) : undefined;
      if (session) rec.retrieves.push(session);
      if (!completed || !order) return;

      if (action === "pay") {
        const expectedMinor = toMinorUnits(offer.price.amount, offer.price.currency);
        rec.checks.orderPaid = order.state === "paid";
        rec.checks.paidByVerifiedCompletedEvent = log.some((l) => isVerifiedPaidLine(l, order.orderId));
        rec.checks.exactlyOnePaidTransition = paidCount(order) === 1;
        rec.checks.sessionCompleteWithDemoTotal = session?.status === "complete" && session.amountTotal === before.totalMinor && before.totalMinor === order.totalMinor;
        rec.checks.sessionAmountEqualsObservedOffer = expectedMinor !== null && session?.amountTotal === expectedMinor;
        rec.checks.sessionCurrencyMatches = session?.currency === lowerCurrency(order) && order.currency === offer.price.currency;
        rec.checks.cartCleared = cart.cart.lines.length === 0;
      } else {
        rec.checks.orderCancelled = order.state === "cancelled";
        rec.checks.neverPaid = paidCount(order) === 0 && order.state !== "paid";
        rec.checks.sessionExpired = session?.status === "expired";
        rec.checks.cartUnchanged = sameLines(cart.cart.lines, before.cart.lines);
        if (action === "decline") {
          rec.observations = {
            paymentFailedEventArrived: rec.events.some((e) => e.type === "payment_intent.payment_failed"),
            declinedAttempts: order.declinedAttempts,
          };
        }
      }
      await ensureEmptyCart(env);
    });

const a6: Runner = ({ env, records }, def) =>
  scenario({ id: def.id, by: "agent" }, A6_CHECKS, async (rec) => {
    const a1 = records.get("A1");
    const paidEvent = a1?.events.find((e) => e.outcome === "applied" && e.to === "paid" && e.type === "checkout.session.completed");
    if (!a1?.orderId || !paidEvent) return block(rec, "A1 recorded no applied checkout.session.completed event to resend");
    const orderId = a1.orderId;
    rec.orderId = orderId;
    rec.sessionId = a1.sessionId;
    const others = async () => JSON.stringify((await allOrders(env)).filter((o) => o.orderId !== orderId).map((o) => [o.orderId, o.state, o.updatedAt, o.transitions.length]));
    const othersBefore = await others();
    const duplicatesBefore = duplicateLines(await env.webhookLog(), paidEvent.eventId);
    const resent = await env.resend(paidEvent.eventId);
    rec.checks.resendExitedZero = resent.exitCode === 0;
    const log = await pollWebhookLog(env, (l) => duplicateLines(l, paidEvent.eventId) > duplicatesBefore, 15, 2_000);
    const outcomes = log.filter((l) => l.eventId === paidEvent.eventId).map((l) => l.outcome ?? "");
    const order = await orderOf(env, orderId);
    rec.events = eventsOf(log, orderId).filter((e) => e.eventId === paidEvent.eventId);
    rec.transitions = transitionsOf(order);
    rec.observations = { eventId: paidEvent.eventId, serverOutcomes: outcomes, duplicatesBefore, resendOutput: redact(resent.output).slice(0, 500) };
    rec.checks.duplicateLineAddedOnce = duplicateLines(log, paidEvent.eventId) === duplicatesBefore + 1;
    rec.checks.serverAnsweredDuplicate = outcomes.length >= 2 && outcomes[0] === "applied" && outcomes.slice(1).every((o) => o === "duplicate");
    rec.checks.exactlyOnePaidTransition = paidCount(order) === 1;
    rec.checks.noOtherOrderChanged = (await others()) === othersBefore;
  });

const a7: Runner = ({ env, offers }, def) =>
  scenario({ id: def.id, by: "agent", query: "Q1" }, A7_CHECKS, async (rec) => {
    const offer = offers.get("Q1");
    if (!offer) return block(rec, "no addable USD offer from Q1");
    const first = await startCheckout(env, rec, offer);
    if (!first) return;
    rec.checks.firstCheckoutStarted = true;
    const second = await env.api("POST", "/api/checkout", {});
    const secondStarted = second.status === 200 ? CheckoutStartedSchema.safeParse(second.body) : undefined;
    if (!secondStarted?.success) {
      rec.notes.push(`the second checkout answered ${second.status}: ${JSON.stringify(second.body)}`);
      return;
    }
    rec.checks.secondCheckoutStarted = true;
    const secondId = secondStarted.data.orderId;
    rec.orderId = secondId;
    const firstOrder = await orderOf(env, first.orderId);
    const secondOrder = await orderOf(env, secondId);
    rec.sessionId = secondOrder?.stripeSessionId ?? undefined;
    const firstSession = firstOrder?.stripeSessionId ? await retrieve(env, "first order's session after the second checkout", firstOrder.stripeSessionId) : undefined;
    const secondOpen = secondOrder?.stripeSessionId ? await retrieve(env, "second order's session while open", secondOrder.stripeSessionId) : undefined;
    rec.checks.firstOrderSuperseded = firstOrder?.state === "expired" && firstOrder.reason === "superseded";
    rec.checks.firstSessionExpired = firstSession?.status === "expired";
    rec.checks.secondOrderOpen = secondOrder?.state === "open" && secondOpen?.status === "open";
    const cancelled = await env.api("POST", `/api/orders/${secondId}/cancel`, {});
    const after = await orderOf(env, secondId);
    const secondClosed = secondOrder?.stripeSessionId ? await retrieve(env, "second order's session after cancel", secondOrder.stripeSessionId) : undefined;
    rec.checks.cancelAnswered200 = cancelled.status === 200;
    rec.checks.secondOrderCancelled = after?.state === "cancelled";
    rec.checks.secondSessionExpired = secondClosed?.status === "expired";
    rec.retrieves = [firstSession, secondOpen, secondClosed].flatMap((s) => s ?? []);
    rec.transitions = transitionsOf(after);
    rec.events = eventsOf(await env.webhookLog(), secondId);
    rec.observations = { firstOrderId: first.orderId, firstSessionId: firstOrder?.stripeSessionId ?? null, firstOrderTransitions: transitionsOf(firstOrder) };
    await ensureEmptyCart(env);
  });

const a8: Runner = ({ env, records }, def) =>
  scenario({ id: def.id, by: "agent" }, A8_CHECKS, async (rec) => {
    const orderId = records.get("A7")?.orderId;
    const order = orderId ? await orderOf(env, orderId) : undefined;
    if (!order?.stripeSessionId) return block(rec, "A7 produced no second order with a session");
    rec.orderId = order.orderId;
    rec.sessionId = order.stripeSessionId;
    const now = env.now();
    const payload = JSON.stringify(
      stripeEventEnvelope(`evt_acceptance_a8_${randomBytes(6).toString("hex")}`, "checkout.session.completed", {
        id: order.stripeSessionId,
        object: "checkout.session",
        client_reference_id: order.orderId,
        status: "complete",
        payment_status: "paid",
        amount_total: order.totalMinor,
        currency: lowerCurrency(order),
        livemode: false,
        metadata: { kensaku_order_id: order.orderId, kensaku_simulated: "true" },
      }),
    );
    const wrongSecret = `whsec_${randomBytes(24).toString("hex")}`;
    const unsigned = await env.webhook(payload);
    const wrong = await env.webhook(payload, signTestPayload(payload, wrongSecret, Math.floor(now.getTime() / 1000)));
    const after = await orderOf(env, order.orderId);
    rec.observations = { unsignedStatus: unsigned, wrongSecretStatus: wrong, orderStateBefore: order.state, orderStateAfter: after?.state ?? null };
    rec.checks.unsignedRejected400 = unsigned === 400;
    rec.checks.wrongSecretRejected400 = wrong === 400;
    rec.checks.orderStillCancelled = order.state === "cancelled" && after?.state === "cancelled" && paidCount(after) === 0;
    rec.transitions = transitionsOf(after);
  });

const RUNNERS: Record<ScenarioId, Runner> = {
  A1: ownerRunner("pay"),
  A2: ownerRunner("pay"),
  A3: ownerRunner("pay"),
  A4: ownerRunner("decline"),
  A5: ownerRunner("back"),
  A6: a6,
  A7: a7,
  A8: a8,
};

const emptyResearch = (q: CaseQuery): ResearchRecord => ({
  id: q.id,
  market: q.market,
  currency: q.currency,
  attempts: [],
  attemptsAnalyzed: 0,
  requests: 0,
  costDollars: 0,
  addableOffers: 0,
  creditsExhausted: false,
  checks: { addableOfferInMarketCurrency: false, noBraceInComparisonOrReason: false, mainListOnlyMarketCurrency: false },
  notes: [],
});

const errorText = (error: unknown): string => redact(error instanceof Error ? error.message : String(error));

const exhaustedCredits = (run: ResearchRun): boolean => run.httpStatus === 402 || run.errorKind === "credits_exhausted" || ofType(run.chunks, "data-error").some((c) => c.data.kind === "credits_exhausted");

async function research(env: AcceptanceEnv, q: CaseQuery, perQuestionCap: number): Promise<{ record: ResearchRecord; offer: RegisteredOffer | undefined }> {
  const record = emptyResearch(q);
  let chosen: RegisteredOffer | undefined;
  let braceSeen = false;
  let foreignCurrencyInMainList = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const refusal = env.exaRefusal();
    if (refusal) {
      record.notes.push(`no research run started: ${refusal}`);
      break;
    }
    let run: ResearchRun;
    try {
      run = await env.research(q);
    } catch (error) {
      run = failedResearchRun(`research attempt ${attempt} threw: ${errorText(error)}`);
    }
    env.recordExaSpend({ requests: run.requests, costDollars: run.costDollars });
    const spent: Attempt = { requests: run.requests, costDollars: run.costDollars, costKnown: run.costKnown, cacheHits: run.cacheHits };
    record.attempts.push(spent);
    if (!run.costKnown) record.notes.push(`attempt ${attempt} reported no cost; counted at the worst case of $${WORST_CASE_ATTEMPT_COST_DOLLARS}`);
    if (run.requests > perQuestionCap) record.notes.push(`attempt ${attempt} used ${run.requests} requests, over the cap of ${perQuestionCap}`);
    if (exhaustedCredits(run)) {
      record.creditsExhausted = true;
      record.notes.push(`attempt ${attempt} stopped: Exa credits are exhausted (402); research stops and the owner decides`);
      break;
    }
    if (run.failure !== undefined) {
      record.notes.push(`research attempt ${attempt} failed: ${redact(run.failure)}`);
      break;
    }
    const analysis = analyzeResearch(run.chunks, q, env.now().toISOString());
    record.attemptsAnalyzed += 1;
    braceSeen ||= analysis.braces.length > 0;
    foreignCurrencyInMainList ||= !analysis.mainListOnlyMarketCurrency;
    record.addableOffers = analysis.addable.length;
    chosen = analysis.addable[0];
    record.chosenOfferId = chosen?.id;
    record.checks = {
      addableOfferInMarketCurrency: chosen !== undefined,
      noBraceInComparisonOrReason: !braceSeen,
      mainListOnlyMarketCurrency: !foreignCurrencyInMainList,
    };
    if (analysis.braces.length > 0) record.notes.push(`brace in: ${analysis.braces.join(", ")} (attempt ${attempt})`);
    if (chosen) break;
    record.notes.push(`attempt ${attempt} yielded no addable ${q.currency} offer${attempt === 1 ? "; asking once more" : ""}`);
  }
  record.requests = record.attempts.reduce((n, a) => n + a.requests, 0);
  record.costDollars = round6(record.attempts.reduce((n, a) => n + a.costDollars, 0));
  return { record, offer: chosen };
}

const researchChecksPass = (records: readonly ResearchRecord[]): boolean =>
  records.every((r) => r.attemptsAnalyzed === 0 || (r.checks.noBraceInComparisonOrReason && r.checks.mainListOnlyMarketCurrency));

async function auditEnd(env: AcceptanceEnv, c: AcceptanceCase, researched: ResearchRecord[], scenarios: ScenarioRecord[], caps: RunLog["exa"]["caps"]) {
  const orders = await allOrders(env);
  const sessions = await Promise.all(
    orders.flatMap((order) => (order.stripeSessionId ? [retrieve(env, "final audit", order.stripeSessionId).then((session) => ({ order, session }))] : [])),
  );
  const usage = env.planUsage();
  const thresholds = computeThresholds({
    scenarios,
    scenariosTotal: c.scenarios.length,
    orders,
    webhook: await env.webhookLog(),
    sessions,
    sandboxSessionId: env.sandboxSessionId,
    exa: { perQueryAttempts: researched.flatMap((r) => r.attempts), ev023Requests: usage.ev023Requests, planRequests: usage.planRequests, planCostDollars: usage.planCostDollars, caps },
    ownerAudit: "PENDING",
  });
  return { thresholds, usage, orderCount: orders.length };
}

export async function runAcceptance(env: AcceptanceEnv, c: AcceptanceCase, runNumber: number, reserve: (startedAt: string) => void = () => {}): Promise<RunLog> {
  const startedAt = env.now().toISOString();
  const preconditions = await env.preconditions();
  const failed = preconditions.filter((p) => !p.ok);
  if (failed.length > 0) throw new AcceptanceAbort(`preconditions failed:\n${failed.map((p) => `  - ${p.name}: ${p.detail}`).join("\n")}`);
  reserve(startedAt);

  const cap = c.budget.exa.perQuestionCap;
  const caps = { ev023: c.budget.exa.ev023MaxRequests, planWide: c.budget.exa.planWideMaxRequests, planWideCostDollars: c.budget.exa.planWideMaxCostDollars, perQuery: cap };
  const notes: string[] = [];
  const researched: ResearchRecord[] = [];
  const scenarios: ScenarioRecord[] = [];
  let aborted = false;

  try {
    const offers = new Map<string, RegisteredOffer | undefined>();
    let exhausted = false;
    for (const q of c.queries) {
      if (exhausted) {
        const skipped = emptyResearch(q);
        skipped.notes.push("not asked: Exa credits are exhausted");
        researched.push(skipped);
        offers.set(q.id, undefined);
        continue;
      }
      env.say(`researching ${q.id} (${q.market}): ${q.text}`);
      const { record, offer } = await research(env, q, cap);
      researched.push(record);
      offers.set(q.id, offer);
      exhausted = record.creditsExhausted;
      env.say(`  ${q.id}: ${record.requests} Exa request(s), ${record.addableOffers} addable ${q.currency} offer(s)`);
    }

    const records = new Map<ScenarioId, ScenarioRecord>();
    for (const def of c.scenarios) {
      env.say(`\n=== ${def.id} (${def.by}${def.query ? `, ${def.query}` : ""}) ===`);
      const record = await RUNNERS[def.id]({ env, offers, records }, def);
      env.say(`${def.id}: ${record.verdict}`);
      records.set(def.id, record);
      scenarios.push(record);
    }
  } catch (error) {
    aborted = true;
    notes.push(`aborted before the run finished: ${errorText(error)}`);
  }

  const ev023Requests = researched.reduce((n, r) => n + r.requests, 0);
  const ev023CostDollars = round6(researched.reduce((n, r) => n + r.costDollars, 0));
  const emptyUsage: PlanUsage = { planRequests: ev023Requests, planCostDollars: ev023CostDollars, ev023Requests };
  let summary: Awaited<ReturnType<typeof auditEnd>>;
  try {
    summary = await auditEnd(env, c, researched, scenarios, caps);
  } catch (error) {
    aborted = true;
    notes.push(`the final audit failed: ${errorText(error)}`);
    summary = {
      thresholds: computeThresholds({
        scenarios,
        scenariosTotal: c.scenarios.length,
        orders: [],
        webhook: [],
        sessions: [],
        sandboxSessionId: env.sandboxSessionId,
        exa: { perQueryAttempts: researched.flatMap((r) => r.attempts), ev023Requests, planRequests: emptyUsage.planRequests, planCostDollars: emptyUsage.planCostDollars, caps },
        ownerAudit: "PENDING",
      }),
      usage: emptyUsage,
      orderCount: 0,
    };
  }
  if (summary.orderCount >= 10) notes.push("the orders API lists at most 10 orders; the threshold counts may miss older ones");
  const researchPass = researchChecksPass(researched);
  const ownerAudit = { H1: "pending", H2: "pending", H3: "pending", H4: "pending", H5: "pending" } as const;
  const blocked = scenarios.filter((s) => s.verdict === "BLOCKED").length;
  return {
    task: "JM-205",
    plan: "kensaku-v1-2",
    evaluation: "EV-023",
    status: aborted ? "aborted" : "complete",
    mode: env.mode,
    run: runNumber,
    gitSha: env.gitSha(),
    gitDirty: env.gitDirty(),
    startedAt,
    finishedAt: env.now().toISOString(),
    preconditions,
    exa: { perQuery: researched, ev023Requests, ev023CostDollars, planRequestsAfter: summary.usage.planRequests, planCostDollarsAfter: summary.usage.planCostDollars, caps },
    scenarios,
    researchChecksPass: researchPass,
    thresholds: summary.thresholds,
    ownerAudit,
    verdict: aborted ? "FAIL" : runVerdict(summary.thresholds, researchPass, blocked),
    notes,
  };
}
