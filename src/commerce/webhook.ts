import { emptyCart, transitionOrder } from "../core/commerce";
import type { CommerceState, Order, OrderState } from "../core/commerce";
import { CheckoutPortError } from "./port";
import type { WebhookEvent } from "./port";
import { verifyWebhook } from "./stripe-port";

export const PROCESSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PROCESSED_MAX = 10_000;

export type ProcessedOutcome = "applied" | "duplicate" | "ignored-type" | "unknown-order" | "mismatch" | "no-transition";
export type RejectedOutcome = "rejected-signature" | "invalid-payload" | "rejected-livemode";
export type WebhookOutcome = ProcessedOutcome | RejectedOutcome;

export interface WebhookResult {
  state: CommerceState;
  outcome: ProcessedOutcome;
  orderId?: string;
  from?: OrderState;
  to?: OrderState;
}

export interface WebhookReply {
  status: 200 | 400;
  outcome: WebhookOutcome;
}

export function recordProcessed(events: CommerceState["processedEvents"], id: string, now: Date): CommerceState["processedEvents"] {
  const cutoff = now.getTime() - PROCESSED_TTL_MS;
  const kept = [...events, { id, at: now.toISOString() }].filter((e) => Date.parse(e.at) >= cutoff);
  return kept.slice(-PROCESSED_MAX);
}

const SESSION_TYPES: ReadonlySet<string> = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
]);
const CARRIES_AMOUNT: ReadonlySet<string> = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const PAYMENT_INTENT_FAILED = "payment_intent.payment_failed";

function sessionMatches(order: Order, event: WebhookEvent): boolean {
  const { object } = event;
  if (object.id !== order.stripeSessionId) return false;
  if (!CARRIES_AMOUNT.has(event.type)) return true;
  return object.amount_total === order.totalMinor && object.currency === order.currency.toLowerCase();
}

export function applyWebhookEvent(state: CommerceState, event: WebhookEvent, now: Date): WebhookResult {
  if (state.processedEvents.some((e) => e.id === event.id)) return { state, outcome: "duplicate" };
  const recorded = (outcome: Exclude<ProcessedOutcome, "duplicate">, next: CommerceState, extra: Partial<WebhookResult> = {}): WebhookResult => ({
    state: { ...next, processedEvents: recordProcessed(next.processedEvents, event.id, now) },
    outcome,
    ...extra,
  });

  const isSession = SESSION_TYPES.has(event.type);
  if (!isSession && event.type !== PAYMENT_INTENT_FAILED) return recorded("ignored-type", state);

  const orderId = isSession ? event.object.client_reference_id : event.object.metadata?.kensaku_order_id;
  const order = orderId ? state.orders.find((o) => o.orderId === orderId) : undefined;
  if (!order) return recorded("unknown-order", state);
  if (isSession && !sessionMatches(order, event)) return recorded("mismatch", state, { orderId: order.orderId });

  const { order: updated, outcome } = transitionOrder(
    order,
    { kind: "stripe", type: event.type, ...(event.object.payment_status != null && { payment_status: event.object.payment_status }) },
    now.toISOString(),
    event.id,
  );
  if (outcome === "no-transition") return recorded("no-transition", state, { orderId: order.orderId });

  const clearsCart = updated.state === "paid" && order.state !== "paid" && state.cart.version === order.cartVersion && state.cart.lines.length > 0;
  const next: CommerceState = {
    ...state,
    cart: clearsCart ? emptyCart(state.cart.version + 1) : state.cart,
    orders: state.orders.map((o) => (o === order ? updated : o)),
  };
  return recorded("applied", next, { orderId: order.orderId, from: order.state, to: updated.state });
}

export interface WebhookInput {
  /** The request body exactly as received: the signature covers these bytes. */
  rawBody: Uint8Array;
  signature: string | undefined;
  secret: string;
}

export async function handleWebhook(
  input: WebhookInput,
  apply: (event: WebhookEvent) => Promise<WebhookResult>,
  log: (line: Record<string, unknown>) => void,
): Promise<WebhookReply> {
  let event: WebhookEvent;
  try {
    event = verifyWebhook(input.rawBody, input.signature, input.secret);
  } catch (error) {
    const outcome = error instanceof CheckoutPortError && error.code === "invalid-payload" ? "invalid-payload" : "rejected-signature";
    log({ event: "webhook", outcome });
    return { status: 400, outcome };
  }
  if (event.livemode || event.object.livemode === true) {
    log({ event: "webhook", eventId: event.id, type: event.type, outcome: "rejected-livemode" });
    return { status: 400, outcome: "rejected-livemode" };
  }
  const result = await apply(event);
  log({
    event: "webhook",
    eventId: event.id,
    type: event.type,
    outcome: result.outcome,
    ...(result.orderId !== undefined && { orderId: result.orderId }),
    ...(result.to !== undefined && { from: result.from, to: result.to }),
  });
  return { status: 200, outcome: result.outcome };
}
