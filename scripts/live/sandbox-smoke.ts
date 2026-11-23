import { buildCheckoutSessionRequest } from "../../src/commerce/session-request";
import type { CheckoutOrderLine, CheckoutPort, SessionResult } from "../../src/commerce/port";
import type { StripeErrorShape } from "../../src/commerce/stripe-port";
import { MIN_UNIT_MINOR, toMinorUnits } from "../../src/core/commerce";
import type { CartLine, Order, RegisteredOffer } from "../../src/core/commerce";
import { CURRENCIES } from "../../src/core/currency";
import type { Currency } from "../../src/core/types";
import { SMOKE_EXA_CAP } from "./exa-counter";

export const EXA_REQUEST_CAP = SMOKE_EXA_CAP;
const EXPECTED_EXPIRY_SECONDS = 3600;
const EXPIRY_TOLERANCE_SECONDS = 120;

/** The one shape of a Stripe key or signing secret. The redactor and the log writer both use it. */
const KEY_SHAPED = /(?:sk|rk|rkcs|pk)_(?:test|live)_\S+|whsec_\S+/;
export const holdsKey = (text: string): boolean => KEY_SHAPED.test(text);
const CARD_LIKE = /\b(?:\d[ -]?){13,19}\b/g;
const BEARER = /Bearer\s+\S+/gi;

export const redact = (text: string): string => text.replace(new RegExp(KEY_SHAPED, "g"), "[redacted]").replace(BEARER, "[redacted]").replace(CARD_LIKE, "[redacted]");

export interface OwnerStep {
  id: "purchase" | "decline";
  orderId: string;
  instructions: string[];
  url: string;
}

/** One `webhook` line of the server log. Stripe event ids are read from here, never from the order API. */
export interface WebhookLogLine {
  eventId?: string;
  type?: string;
  outcome?: string;
  orderId?: string;
  to?: string;
}

export interface SmokeEnv {
  mode: "live" | "dry-run";
  port: CheckoutPort;
  lastRawError(): StripeErrorShape | undefined;
  api(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  offers(): Promise<{ offers: RegisteredOffer[]; exaRequests: number; source: "research" | "registered" }>;
  /** Tells the owner what to do and returns once `done()` is true or the step times out (false). */
  ownerStep(step: OwnerStep, done: () => Promise<boolean>): Promise<boolean>;
  resend(eventId: string): Promise<{ exitCode: number | null; output: string }>;
  webhookLog(): Promise<WebhookLogLine[]>;
  now(): Date;
  sleep(ms: number): Promise<void>;
  gitSha(): string;
}

export interface AgentSession {
  currency: Currency;
  /** True: a fixed test item stood in for a registered offer. The session is created, retrieved and expired, never paid. */
  syntheticSessionOnly: boolean;
  syntheticReason?: string;
  sessionId: string;
  livemode: boolean;
  urlHost: string;
  requestHadTopLevelCurrency: boolean;
  expiresInSeconds: number;
  amountTotal: number | null;
  expectedAmountMinor: number;
  sessionCurrency: string | null;
  retrievedStatus: string;
  statusAfterExpire: string;
}

export interface SmokeEvidence {
  task: "JM-203";
  plan: "kensaku-v1-2";
  mode: SmokeEnv["mode"];
  gitSha: string;
  startedAt: string;
  finishedAt: string;
  exa: { requests: number; cap: number; source: "research" | "registered" };
  agentSessions: AgentSession[];
  expireAgain: { sessionId: string; outcome: "ok" | "error"; portCode?: string; rawShape?: { type?: string; code?: string; statusCode?: number; message?: string }; statusAfter?: string };
  purchase: { orderId: string; sessionId: string | null; completed: boolean; statesSeen: string[]; finalState: string; paidEventId: string | null; amountMatchesSession: boolean; cartClearedAfter: boolean };
  decline: { orderId: string; completed: boolean; finalState: string; declinedAttempts: number; paymentFailedEventArrived: boolean; sessionStatusAfter: string; cartUnchanged: boolean };
  resend: { eventId: string; exitCode: number | null; output: string; serverOutcomes: string[]; duplicateAnswered: boolean; paidTransitionsAfter: number };
  checks: Record<string, boolean>;
  pass: boolean;
  notes: string[];
}

export class SmokeAbort extends Error {}

const SYNTHETIC_REASON = `Q1 yields no ${CURRENCIES.filter((c) => c !== "USD").join("/")} registered offers within the ${SMOKE_EXA_CAP}-request smoke budget`;

const ownerTimeoutNote = (what: string) => `${what}: the owner step timed out`;

function syntheticOffer(currency: Currency, nowIso: string): RegisteredOffer {
  const amount = currency === "JPY" ? 2000 : 20;
  return {
    id: `synthetic-${currency}`.padEnd(64, "0"),
    canonicalUrl: `https://smoke.example.com/${currency.toLowerCase()}`,
    merchantHost: "smoke.example.com",
    merchantName: "Smoke test",
    productName: `Synthetic ${currency} test item`,
    price: { amount, currency },
    availability: "in_stock",
    exaRequestId: "req_smoke",
    retrievedAt: nowIso,
    market: currency === "USD" ? "US" : currency === "SGD" ? "SG" : "JP",
    registeredAt: nowIso,
  };
}

const unit = (offer: RegisteredOffer): number | null => toMinorUnits(offer.price.amount, offer.price.currency);
const addable = (offer: RegisteredOffer): boolean => offer.availability !== "out_of_stock" && (unit(offer) ?? 0) >= MIN_UNIT_MINOR;

const lineOf = (offer: RegisteredOffer): CheckoutOrderLine => ({
  productName: offer.productName,
  merchantHost: offer.merchantHost,
  quantity: 1,
  demoUnitAmountMinor: unit(offer) ?? 0,
  observed: { amount: offer.price.amount, currency: offer.price.currency, retrievedAt: offer.retrievedAt, merchantHost: offer.merchantHost },
});

const hostOf = (url: string | null): string => {
  try {
    return url === null ? "" : new URL(url).host;
  } catch {
    return "";
  }
};

async function agentSession(env: SmokeEnv, currency: Currency, offer: RegisteredOffer, syntheticSessionOnly: boolean): Promise<AgentSession> {
  const now = env.now();
  const orderId = `ord_smoke_${currency.toLowerCase()}_${now.getTime().toString(36)}`;
  const { params, options } = buildCheckoutSessionRequest({ orderId, currency, lines: [lineOf(offer)] }, { port: 8787, now });
  const created = await env.port.createSession(params, options);
  const retrieved = await env.port.retrieveSession(created.id);
  await env.port.expireSession(created.id);
  const after = await env.port.retrieveSession(created.id);
  return {
    currency,
    syntheticSessionOnly,
    ...(syntheticSessionOnly && { syntheticReason: SYNTHETIC_REASON }),
    sessionId: created.id,
    livemode: created.livemode,
    urlHost: hostOf(created.url),
    requestHadTopLevelCurrency: "currency" in params,
    expiresInSeconds: params.expires_at - Math.floor(now.getTime() / 1000),
    amountTotal: retrieved.amountTotal,
    expectedAmountMinor: unit(offer) ?? 0,
    sessionCurrency: retrieved.currency,
    retrievedStatus: retrieved.status,
    statusAfterExpire: after.status,
  };
}

async function expireAgain(env: SmokeEnv, sessionId: string): Promise<SmokeEvidence["expireAgain"]> {
  try {
    await env.port.expireSession(sessionId);
    return { sessionId, outcome: "ok" };
  } catch (error) {
    const raw = env.lastRawError();
    const statusAfter = (await env.port.retrieveSession(sessionId).catch(() => undefined))?.status;
    return {
      sessionId,
      outcome: "error",
      portCode: (error as { code?: string }).code ?? "unknown",
      ...(raw && { rawShape: { ...(raw.type && { type: raw.type }), ...(raw.code && { code: raw.code }), ...(raw.statusCode !== undefined && { statusCode: raw.statusCode }), ...(raw.message && { message: redact(raw.message) }) } }),
      ...(statusAfter && { statusAfter }),
    };
  }
}

const orderOf = async (env: SmokeEnv, id: string): Promise<Order | undefined> => {
  const reply = await env.api("GET", `/api/orders/${id}`);
  return reply.status === 200 ? (reply.body as { order: Order }).order : undefined;
};
const cartLines = async (env: SmokeEnv): Promise<CartLine[]> => ((await env.api("GET", "/api/cart")).body as { cart: { lines: CartLine[] } }).cart.lines;

async function ownerCheckout(env: SmokeEnv, id: OwnerStep["id"], offer: RegisteredOffer, instructions: string[]) {
  const added = await env.api("POST", "/api/cart/items", { offerId: offer.id });
  if (added.status !== 200) throw new SmokeAbort(`could not add the ${offer.price.currency} offer to the cart (${added.status}): ${JSON.stringify(added.body)}`);
  const started = await env.api("POST", "/api/checkout", {});
  if (started.status !== 200) throw new SmokeAbort(`checkout was refused (${started.status}): ${JSON.stringify(started.body)}`);
  const { orderId, url } = started.body as { orderId: string; url: string };
  const statesSeen: string[] = [];
  const completed = await env.ownerStep({ id, orderId, instructions, url }, async () => {
    const state = (await orderOf(env, orderId))?.state;
    if (state && statesSeen.at(-1) !== state) statesSeen.push(state);
    return state !== undefined && state !== "open";
  });
  return { orderId, completed, statesSeen, order: await orderOf(env, orderId) };
}

/** Runs the whole smoke. Throws `SmokeAbort` when a precondition fails; otherwise returns evidence whose `pass` says the outcome. */
export async function runSmoke(env: SmokeEnv): Promise<SmokeEvidence> {
  const startedAt = env.now().toISOString();
  const notes: string[] = [];

  const health = await env.api("GET", "/api/cart");
  const view = health.body as { cart?: { lines: unknown[] }; checkoutConfigured?: boolean };
  if (health.status !== 200 || !view.cart) throw new SmokeAbort(`GET /api/cart answered ${health.status}: is the server running with commerce available?`);
  if (view.checkoutConfigured !== true) throw new SmokeAbort("the server reports checkout is not configured: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in the env file the server reads.");
  if (view.cart.lines.length > 0) throw new SmokeAbort("the server's cart is not empty: start from an empty .data/commerce/.");

  const found = await env.offers();
  const byCurrency = new Map<Currency, RegisteredOffer>();
  for (const offer of found.offers.filter(addable)) if (!byCurrency.has(offer.price.currency)) byCurrency.set(offer.price.currency, offer);
  const usd = byCurrency.get("USD");
  if (!usd) throw new SmokeAbort("no addable USD offer was registered: ask again once (within the Exa cap) or pass --offer-id.");

  const agentSessions: AgentSession[] = [];
  for (const currency of CURRENCIES) {
    const registered = byCurrency.get(currency);
    if (!registered) notes.push(`${currency}: syntheticSessionOnly, a fixed test item was created, retrieved and expired but never paid`);
    agentSessions.push(await agentSession(env, currency, registered ?? syntheticOffer(currency, env.now().toISOString()), registered === undefined));
  }
  const again = await expireAgain(env, agentSessions[0]!.sessionId);

  const purchased = await ownerCheckout(env, "purchase", usd, [
    "Pay with the Stripe test card 4242 4242 4242 4242, any future expiry, any CVC.",
    "Kensaku must show the order as paid only after Stripe's webhook arrives (`stripe listen` must be running).",
  ]);
  const paid = purchased.order;
  const sessionOfPurchase = paid?.stripeSessionId ?? null;
  const retrievedPurchase = sessionOfPurchase ? await env.port.retrieveSession(sessionOfPurchase).catch(() => undefined) : undefined;
  const purchase: SmokeEvidence["purchase"] = {
    orderId: purchased.orderId,
    sessionId: sessionOfPurchase,
    completed: purchased.completed,
    statesSeen: purchased.statesSeen,
    finalState: paid?.state ?? "unknown",
    paidEventId: (await env.webhookLog()).find((l) => l.orderId === purchased.orderId && l.outcome === "applied" && l.to === "paid")?.eventId ?? null,
    amountMatchesSession: retrievedPurchase !== undefined && retrievedPurchase.amountTotal === paid?.totalMinor && retrievedPurchase.currency === paid?.currency.toLowerCase(),
    cartClearedAfter: (await cartLines(env)).length === 0,
  };
  if (!purchase.completed) notes.push(ownerTimeoutNote("purchase"));

  const declined = await ownerCheckout(env, "decline", usd, [
    "Pay with the generic decline test card 4000 0000 0000 0002, any future expiry, any CVC.",
    "After Stripe shows the decline, use the hosted page's back link to return to Kensaku. Kensaku then cancels the checkout.",
  ]);
  const linesAfterDecline = await cartLines(env);
  const declinedSession: SessionResult | undefined = declined.order?.stripeSessionId ? await env.port.retrieveSession(declined.order.stripeSessionId).catch(() => undefined) : undefined;
  const webhookLines = await env.webhookLog();
  const decline: SmokeEvidence["decline"] = {
    orderId: declined.orderId,
    completed: declined.completed,
    finalState: declined.order?.state ?? "unknown",
    declinedAttempts: declined.order?.declinedAttempts ?? 0,
    paymentFailedEventArrived: (declined.order?.declinedAttempts ?? 0) >= 1 || webhookLines.some((l) => l.type === "payment_intent.payment_failed"),
    sessionStatusAfter: declinedSession?.status ?? "unknown",
    cartUnchanged: linesAfterDecline.length >= 1,
  };
  if (!decline.completed) notes.push(ownerTimeoutNote("decline"));
  await env.api("DELETE", "/api/cart");

  const eventId = purchase.paidEventId ?? "";
  const resent = eventId ? await env.resend(eventId) : { exitCode: null, output: "no paid event id to resend" };
  await env.sleep(5_000);
  const outcomes = (await env.webhookLog()).filter((l) => l.eventId === eventId).map((l) => l.outcome ?? "");
  const afterResend = purchased.orderId ? await orderOf(env, purchased.orderId) : undefined;
  const resend: SmokeEvidence["resend"] = {
    eventId,
    exitCode: resent.exitCode,
    output: redact(resent.output).slice(0, 2000),
    serverOutcomes: outcomes,
    duplicateAnswered: outcomes.length >= 2 && outcomes[0] === "applied" && outcomes.slice(1).every((o) => o === "duplicate"),
    paidTransitionsAfter: afterResend?.transitions.filter((t) => t.to === "paid").length ?? 0,
  };

  const evidence: SmokeEvidence = {
    task: "JM-203",
    plan: "kensaku-v1-2",
    mode: env.mode,
    gitSha: env.gitSha(),
    startedAt,
    finishedAt: env.now().toISOString(),
    exa: { requests: found.exaRequests, cap: EXA_REQUEST_CAP, source: found.source },
    agentSessions,
    expireAgain: again,
    purchase,
    decline,
    resend,
    checks: {},
    pass: false,
    notes,
  };
  evidence.checks = evaluate(evidence);
  evidence.pass = Object.values(evidence.checks).every(Boolean);
  return evidence;
}

export function evaluate(e: SmokeEvidence): Record<string, boolean> {
  const sessionOk = (s: AgentSession) =>
    s.sessionId !== "" &&
    !s.livemode &&
    (e.mode === "dry-run" || s.urlHost === "checkout.stripe.com") &&
    !s.requestHadTopLevelCurrency &&
    Math.abs(s.expiresInSeconds - EXPECTED_EXPIRY_SECONDS) <= EXPIRY_TOLERANCE_SECONDS &&
    s.amountTotal === s.expectedAmountMinor &&
    s.sessionCurrency === s.currency.toLowerCase() &&
    s.retrievedStatus === "open" &&
    s.statusAfterExpire === "expired";
  return {
    "usd, sgd and jpy sessions created, retrieved, expired": CURRENCIES.every((c) => e.agentSessions.some((s) => s.currency === c && sessionOk(s))),
    "no live-mode session": e.agentSessions.every((s) => !s.livemode),
    "exa requests within the cap": e.exa.requests <= e.exa.cap,
    "expire of an expired session recorded": e.expireAgain.outcome === "ok" || e.expireAgain.portCode !== undefined,
    "purchase paid after a verified event": e.purchase.completed && e.purchase.finalState === "paid" && e.purchase.paidEventId !== null && e.purchase.statesSeen[0] === "open",
    "purchase amount equals the session": e.purchase.amountMatchesSession,
    "decline never paid and cancelled": e.decline.completed && e.decline.finalState === "cancelled" && e.decline.cartUnchanged,
    "decline session expired": e.decline.sessionStatusAfter === "expired",
    "resend answered duplicate, one paid transition": e.resend.exitCode === 0 && e.resend.duplicateAnswered && e.resend.paidTransitionsAfter === 1,
  };
}
