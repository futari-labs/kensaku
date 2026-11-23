// EV-023, the kensaku-v1-2 live sandbox acceptance (evals/cases/live-acceptance-v1-2.json), as a flow over `AcceptanceEnv`.
// The live env (acceptance-env.ts) talks to the real server, the Stripe sandbox and the owner; the dry env swaps in a fake
// port and fixture research. Nothing here automates the Stripe-hosted page: owner scenarios print the page's URL and wait.
import { randomBytes } from "node:crypto";
import { signTestPayload, stripeEventEnvelope } from "../../src/commerce/stripe-port";
import type { CheckoutPort } from "../../src/commerce/port";
import { formatMinor, toMinorUnits, toRegisteredOffer } from "../../src/core/commerce";
import type { Cart, CartLine, Order, RegisteredOffer } from "../../src/core/commerce";
import type { Market } from "../../src/core/types";
import { buyBlock, offerView } from "../../src/web/app/offers";
import { ofType } from "../../tests/server/sse";
import type { Chunk } from "../../tests/server/sse";
import { auditAllYes, computeThresholds, isVerifiedPaidLine, runVerdict } from "./acceptance-log";
import type { AcceptanceCase, Attempt, CaseQuery, EventRecord, ResearchRecord, RunLog, ScenarioRecord, SessionAudit } from "./acceptance-log";
import type { ExaCounter } from "./exa-counter";
import { redact, SmokeAbort } from "./sandbox-smoke";
import type { WebhookLogLine } from "./sandbox-smoke";

export class AcceptanceAbort extends SmokeAbort {}

export interface Precondition {
  name: string;
  ok: boolean;
  detail: string;
}

export interface AcceptanceStep {
  id: string;
  action: "pay" | "decline" | "back";
  orderId: string;
  /** The Stripe-hosted page. Printed for the owner, never recorded and never opened by the script. */
  url: string;
  /** The frozen steps and expectation from the case file. */
  steps: string;
  expect: string;
  demoTotal: string;
}

export interface ResearchRun {
  chunks: Chunk[];
  requests: number;
  costDollars: number;
  cacheHits: number;
}

export interface AcceptanceEnv {
  mode: "live" | "dry-run";
  port: CheckoutPort;
  api(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  /** POSTs the raw body to the webhook route, with the Stripe-Signature header when given; returns the HTTP status. */
  webhook(rawBody: string, signature?: string): Promise<number>;
  preconditions(): Promise<Precondition[]>;
  /** Why the next research run may not start (its worst case would pass an Exa cap), or undefined. */
  exaRefusal(): string | undefined;
  exaCounter(): ExaCounter;
  /** One research run through the real app. Adds what it spent to the plan-wide counter itself. */
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

export interface ResearchAnalysis {
  addable: RegisteredOffer[];
  braces: string[];
  mainListOnlyMarketCurrency: boolean;
}

/** What the page would show for one research stream: addable local offers in card order, braces in prose, and the main list's currency. */
export function analyzeResearch(chunks: readonly Chunk[], query: Pick<CaseQuery, "market" | "currency">, at: string): ResearchAnalysis {
  const products = ofType([...chunks], "data-products").at(-1)?.data ?? [];
  const market: Market = query.market;
  const views = products.map((p) => offerView(p, market));
  const local = views.flatMap((v) => (v.kind === "offers" ? v.local : []));
  const comparison = ofType([...chunks], "text-delta").map((c) => c.delta).join("");
  const braces = [
    ...(/[{}]/.test(comparison) ? ["comparison"] : []),
    ...products.flatMap((p, i) => (p.reason?.renderedText && /[{}]/.test(p.reason.renderedText) ? [`reason of card ${i + 1}`] : [])),
  ];
  return {
    addable: local.filter((o) => buyBlock(o, undefined) === undefined).flatMap((o) => toRegisteredOffer(o, market, at) ?? []),
    braces,
    mainListOnlyMarketCurrency:
      local.every((o) => o.price.currency === query.currency) && products.every((p) => p.offerGroups.every((g) => g.offers.every((o) => o.price.currency === g.currency))),
  };
}

const lowerCurrency = (order: Pick<Order, "currency">) => order.currency.toLowerCase();

async function retrieve(env: AcceptanceEnv, label: string, sessionId: string): Promise<SessionAudit> {
  try {
    const s = await env.port.retrieveSession(sessionId);
    return { label, sessionId, status: s.status, amountTotal: s.amountTotal, currency: s.currency, livemode: s.livemode as boolean };
  } catch {
    return { label, sessionId, status: "unretrievable", amountTotal: null, currency: null, livemode: false };
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
  const own = new Set(log.filter((l) => l.orderId === orderId && l.eventId).map((l) => l.eventId));
  return log
    .filter((l) => l.eventId !== undefined && own.has(l.eventId))
    .map((l) => ({ eventId: l.eventId!, type: l.type ?? "", outcome: l.outcome ?? "", ...(l.to && { to: l.to }) }));
}

const transitionsOf = (order: Order | undefined) => (order?.transitions ?? []).map((t) => ({ from: t.from, to: t.to, at: t.at }));
const paidCount = (order: Order | undefined) => (order?.transitions ?? []).filter((t) => t.to === "paid").length;

interface Spec {
  id: string;
  by: "owner" | "agent";
  query?: string;
}

async function scenario(spec: Spec, body: (rec: ScenarioRecord) => Promise<void>): Promise<ScenarioRecord> {
  const rec: ScenarioRecord = { ...spec, verdict: "FAIL", events: [], transitions: [], retrieves: [], checks: {}, observations: {}, notes: [] };
  try {
    await body(rec);
  } catch (error) {
    rec.notes.push(`stopped by an error: ${redact(error instanceof Error ? error.message : String(error))}`);
    rec.checks.noError = false;
  }
  if (rec.verdict !== "BLOCKED") rec.verdict = Object.keys(rec.checks).length > 0 && Object.values(rec.checks).every(Boolean) ? "PASS" : "FAIL";
  return rec;
}

const block = (rec: ScenarioRecord, reason: string) => {
  rec.verdict = "BLOCKED";
  rec.notes.push(`BLOCKED: ${reason}`);
};

async function ensureEmptyCart(env: AcceptanceEnv): Promise<void> {
  if ((await cartOf(env)).cart.lines.length > 0) await env.api("DELETE", "/api/cart");
}

async function startCheckout(env: AcceptanceEnv, rec: ScenarioRecord, offer: RegisteredOffer): Promise<{ orderId: string; url: string } | undefined> {
  await ensureEmptyCart(env);
  const added = await env.api("POST", "/api/cart/items", { offerId: offer.id });
  if (added.status !== 200) {
    rec.notes.push(`adding the ${offer.price.currency} offer to the cart answered ${added.status}: ${JSON.stringify(added.body)}`);
    rec.checks.offerAddedToCart = false;
    return undefined;
  }
  const started = await env.api("POST", "/api/checkout", {});
  if (started.status !== 200) {
    rec.notes.push(`checkout answered ${started.status}: ${JSON.stringify(started.body)}`);
    rec.checks.checkoutStarted = false;
    return undefined;
  }
  return started.body as { orderId: string; url: string };
}

const ACTION: Record<string, AcceptanceStep["action"]> = { A1: "pay", A2: "pay", A3: "pay", A4: "decline", A5: "back" };

async function ownerScenario(env: AcceptanceEnv, c: AcceptanceCase, id: string, query: string, offer: RegisteredOffer | undefined, timeoutNote: string): Promise<ScenarioRecord> {
  const def = c.scenarios.find((s) => s.id === id)!;
  return scenario({ id, by: "owner", query }, async (rec) => {
    if (!offer) return block(rec, `no addable offer for ${query}`);
    const started = await startCheckout(env, rec, offer);
    if (!started) return;
    const before = await cartOf(env);
    rec.orderId = started.orderId;
    const completed = await env.ownerStep(
      { id, action: ACTION[id]!, orderId: started.orderId, url: started.url, steps: def.steps, expect: def.expect, demoTotal: `${formatMinor(before.totalMinor, offer.price.currency)} ${offer.price.currency}` },
      async () => ((await orderOf(env, started.orderId))?.state ?? "open") !== "open",
    );
    rec.checks.ownerCompletedStep = completed;
    if (!completed) {
      rec.notes.push(timeoutNote);
      await env.api("POST", `/api/orders/${started.orderId}/cancel`, {});
    }
    const order = await orderOf(env, started.orderId);
    const log = await env.webhookLog();
    const cart = await cartOf(env);
    rec.sessionId = order?.stripeSessionId ?? undefined;
    rec.events = eventsOf(log, started.orderId);
    rec.transitions = transitionsOf(order);
    const session = order?.stripeSessionId ? await retrieve(env, "audit after the owner step", order.stripeSessionId) : undefined;
    if (session) rec.retrieves.push(session);
    if (!completed || !order) return;

    if (ACTION[id] === "pay") {
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
      if (ACTION[id] === "decline") {
        rec.observations = {
          paymentFailedEventArrived: rec.events.some((e) => e.type === "payment_intent.payment_failed"),
          declinedAttempts: order.declinedAttempts,
        };
      }
    }
    await ensureEmptyCart(env);
  });
}

async function a6(env: AcceptanceEnv, a1: ScenarioRecord): Promise<ScenarioRecord> {
  return scenario({ id: "A6", by: "agent" }, async (rec) => {
    const paidEvent = a1.events.find((e) => e.outcome === "applied" && e.to === "paid" && e.type === "checkout.session.completed");
    if (!a1.orderId || !paidEvent) return block(rec, "A1 recorded no applied checkout.session.completed event to resend");
    rec.orderId = a1.orderId;
    rec.sessionId = a1.sessionId;
    const others = async () => JSON.stringify((await allOrders(env)).filter((o) => o.orderId !== a1.orderId).map((o) => [o.orderId, o.state, o.updatedAt, o.transitions.length]));
    const othersBefore = await others();
    const resent = await env.resend(paidEvent.eventId);
    rec.checks.resendExitedZero = resent.exitCode === 0;
    let outcomes: string[] = [];
    for (let i = 0; i < 15 && outcomes.length < 2; i++) {
      await env.sleep(2_000);
      outcomes = (await env.webhookLog()).filter((l) => l.eventId === paidEvent.eventId).map((l) => l.outcome ?? "");
    }
    const order = await orderOf(env, a1.orderId);
    rec.events = eventsOf(await env.webhookLog(), a1.orderId).filter((e) => e.eventId === paidEvent.eventId);
    rec.transitions = transitionsOf(order);
    rec.observations = { eventId: paidEvent.eventId, serverOutcomes: outcomes, resendOutput: redact(resent.output).slice(0, 500) };
    rec.checks.serverAnsweredDuplicate = outcomes.length >= 2 && outcomes[0] === "applied" && outcomes.slice(1).every((o) => o === "duplicate");
    rec.checks.exactlyOnePaidTransition = paidCount(order) === 1;
    rec.checks.noOtherOrderChanged = (await others()) === othersBefore;
  });
}

async function a7(env: AcceptanceEnv, offer: RegisteredOffer | undefined): Promise<ScenarioRecord> {
  return scenario({ id: "A7", by: "agent", query: "Q1" }, async (rec) => {
    if (!offer) return block(rec, "no addable USD offer from Q1");
    const first = await startCheckout(env, rec, offer);
    if (!first) return;
    const second = await env.api("POST", "/api/checkout", {});
    if (second.status !== 200) {
      rec.notes.push(`the second checkout answered ${second.status}: ${JSON.stringify(second.body)}`);
      rec.checks.secondCheckoutStarted = false;
      return;
    }
    const secondId = (second.body as { orderId: string }).orderId;
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
}

async function a8(env: AcceptanceEnv, a7Record: ScenarioRecord): Promise<ScenarioRecord> {
  return scenario({ id: "A8", by: "agent" }, async (rec) => {
    const order = a7Record.orderId ? await orderOf(env, a7Record.orderId) : undefined;
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
}

async function research(env: AcceptanceEnv, q: CaseQuery, perQuestionCap: number): Promise<{ record: ResearchRecord; offer: RegisteredOffer | undefined }> {
  const record: ResearchRecord = {
    id: q.id,
    market: q.market,
    currency: q.currency,
    attempts: [],
    requests: 0,
    costDollars: 0,
    addableOffers: 0,
    checks: { addableOfferInMarketCurrency: false, noBraceInComparisonOrReason: false, mainListOnlyMarketCurrency: false },
    notes: [],
  };
  let chosen: RegisteredOffer | undefined;
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
      record.notes.push(`research attempt ${attempt} failed: ${redact(error instanceof Error ? error.message : String(error))}`);
      break;
    }
    const spent: Attempt = { requests: run.requests, costDollars: run.costDollars, cacheHits: run.cacheHits };
    record.attempts.push(spent);
    if (run.requests > perQuestionCap) record.notes.push(`attempt ${attempt} used ${run.requests} requests, over the cap of ${perQuestionCap}`);
    const analysis = analyzeResearch(run.chunks, q, env.now().toISOString());
    record.addableOffers = analysis.addable.length;
    chosen = analysis.addable[0];
    record.chosenOfferId = chosen?.id;
    record.checks = {
      addableOfferInMarketCurrency: chosen !== undefined,
      noBraceInComparisonOrReason: analysis.braces.length === 0,
      mainListOnlyMarketCurrency: analysis.mainListOnlyMarketCurrency,
    };
    if (analysis.braces.length > 0) record.notes.push(`brace in: ${analysis.braces.join(", ")}`);
    if (chosen) break;
    record.notes.push(`attempt ${attempt} yielded no addable ${q.currency} offer${attempt === 1 ? "; asking once more" : ""}`);
  }
  record.requests = record.attempts.reduce((n, a) => n + a.requests, 0);
  record.costDollars = Math.round(record.attempts.reduce((n, a) => n + a.costDollars, 0) * 1e6) / 1e6;
  return { record, offer: chosen };
}

/** Runs EV-023. Throws `AcceptanceAbort` when a precondition fails, before anything is spent; otherwise returns the run log (audit PENDING). */
export async function runAcceptance(env: AcceptanceEnv, c: AcceptanceCase, runNumber: number): Promise<RunLog> {
  const startedAt = env.now().toISOString();
  const preconditions = await env.preconditions();
  const failed = preconditions.filter((p) => !p.ok);
  if (failed.length > 0) throw new AcceptanceAbort(`preconditions failed:\n${failed.map((p) => `  - ${p.name}: ${p.detail}`).join("\n")}`);

  const cap = c.budget.exa.perQuestionCap;
  const offers = new Map<string, RegisteredOffer | undefined>();
  const researched: ResearchRecord[] = [];
  for (const q of c.queries) {
    env.say(`researching ${q.id} (${q.market}): ${q.text}`);
    const { record, offer } = await research(env, q, cap);
    researched.push(record);
    offers.set(q.id, offer);
    env.say(`  ${q.id}: ${record.requests} Exa request(s), ${record.addableOffers} addable ${q.currency} offer(s)`);
  }

  const scenarios: ScenarioRecord[] = [];
  const owner = async (id: string, query: string) => {
    env.say(`\n=== ${id} (owner, ${query}) ===`);
    const record = await ownerScenario(env, c, id, query, offers.get(query), `${id}: the owner step did not finish before the timeout`);
    env.say(`${id}: ${record.verdict}`);
    scenarios.push(record);
    return record;
  };
  const agent = async (id: string, run: () => Promise<ScenarioRecord>) => {
    env.say(`\n=== ${id} (agent) ===`);
    const record = await run();
    env.say(`${id}: ${record.verdict}`);
    scenarios.push(record);
    return record;
  };
  const a1 = await owner("A1", "Q1");
  await owner("A2", "Q3");
  await owner("A3", "Q5");
  await owner("A4", "Q1");
  await owner("A5", "Q3");
  await agent("A6", () => a6(env, a1));
  const seven = await agent("A7", () => a7(env, offers.get("Q1")));
  await agent("A8", () => a8(env, seven));

  const orders = await allOrders(env);
  const sessions = await Promise.all(
    orders.flatMap((order) => (order.stripeSessionId ? [retrieve(env, "final audit", order.stripeSessionId).then((session) => ({ order, session }))] : [])),
  );
  const counter = env.exaCounter();
  const ev023Requests = researched.reduce((n, r) => n + r.requests, 0);
  const ev023CostDollars = Math.round(researched.reduce((n, r) => n + r.costDollars, 0) * 1e6) / 1e6;
  const caps = { ev023: c.budget.exa.ev023MaxRequests, planWide: c.budget.exa.planWideMaxRequests, planWideCostDollars: c.budget.exa.planWideMaxCostDollars, perQuery: cap };
  const researchChecksPass = researched.every((r) => Object.values(r.checks).every(Boolean));
  const ownerAudit = { H1: "pending", H2: "pending", H3: "pending", H4: "pending", H5: "pending" } as const;
  const thresholds = computeThresholds({
    scenarios,
    orders,
    webhook: await env.webhookLog(),
    sessions,
    sandboxSessionId: env.sandboxSessionId,
    exa: { perQueryAttempts: researched.flatMap((r) => r.attempts), ev023Requests, ev023CostDollars, planRequests: counter.planRequests, caps },
    ownerAudit: auditAllYes(ownerAudit),
  });
  const notes: string[] = [];
  if (orders.length >= 10) notes.push("the orders API lists at most 10 orders; the threshold counts may miss older ones");
  return {
    task: "JM-205",
    plan: "kensaku-v1-2",
    evaluation: "EV-023",
    mode: env.mode,
    run: runNumber,
    gitSha: env.gitSha(),
    gitDirty: env.gitDirty(),
    startedAt,
    finishedAt: env.now().toISOString(),
    preconditions,
    exa: { perQuery: researched, ev023Requests, ev023CostDollars, planRequestsAfter: counter.planRequests, caps },
    scenarios,
    researchChecksPass,
    thresholds,
    ownerAudit,
    verdict: runVerdict(thresholds, researchChecksPass),
    notes,
  };
}
