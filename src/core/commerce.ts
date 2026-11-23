import { z } from "zod";
import { MARKET_CURRENCY, MINOR_DIGITS, isAvailability, isSupportedCurrency } from "./currency";
import type { Currency, Market, Offer } from "./types";

const guarded = <T extends string>(is: (value: string) => value is T) => z.custom<T>((value): value is T => typeof value === "string" && is(value));
export const CurrencySchema = guarded(isSupportedCurrency);
const AvailabilitySchema = guarded(isAvailability);
const MarketSchema = guarded((value): value is Market => Object.hasOwn(MARKET_CURRENCY, value));
const Count = z.number().int().nonnegative();

export const ORDER_STATES = ["open", "paid", "cancelled", "expired", "payment_failed", "failed"] as const;
export const OrderStateSchema = z.enum(ORDER_STATES);
export type OrderState = z.infer<typeof OrderStateSchema>;

export const OFFER_ID_PATTERN = /^[0-9a-f]{64}$/;

export const RegisteredOfferSchema = z.object({
  id: z.string().regex(OFFER_ID_PATTERN),
  canonicalUrl: z.string(),
  merchantHost: z.string(),
  merchantName: z.string(),
  productName: z.string(),
  price: z.object({ amount: z.number(), currency: CurrencySchema }),
  availability: AvailabilitySchema,
  exaRequestId: z.string(),
  retrievedAt: z.string(),
  market: MarketSchema,
  registeredAt: z.string(),
});
export type RegisteredOffer = z.infer<typeof RegisteredOfferSchema>;

export const CartLineSchema = z.object({
  offerId: z.string(),
  productName: z.string(),
  merchantHost: z.string(),
  quantity: Count,
  demoUnitAmountMinor: Count,
  observed: z.object({ amount: z.number(), currency: CurrencySchema, retrievedAt: z.string(), merchantHost: z.string() }),
});
export type CartLine = z.infer<typeof CartLineSchema>;

export const CartSchema = z.object({ version: Count, currency: CurrencySchema.nullable(), lines: z.array(CartLineSchema) });
export type Cart = z.infer<typeof CartSchema>;

export const OrderSchema = z.object({
  orderId: z.string(),
  state: OrderStateSchema,
  reason: z.literal("superseded").optional(),
  anomaly: z.string().optional(),
  currency: CurrencySchema,
  lines: z.array(CartLineSchema),
  totalMinor: Count,
  cartVersion: Count,
  stripeSessionId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  declinedAttempts: Count,
  awaitingAsyncPayment: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  transitions: z.array(z.object({ at: z.string(), from: OrderStateSchema.nullable(), to: OrderStateSchema, eventId: z.string().optional() })),
});
export type Order = z.infer<typeof OrderSchema>;

export const CommerceStateSchema = z.object({
  version: z.literal(1),
  cart: CartSchema,
  orders: z.array(OrderSchema),
  processedEvents: z.array(z.object({ id: z.string(), at: z.string() })),
});
export type CommerceState = z.infer<typeof CommerceStateSchema>;

export function toRegisteredOffer(offer: Offer, market: Market, at: string): RegisteredOffer | undefined {
  if (offer.id === undefined) return undefined;
  return {
    id: offer.id,
    canonicalUrl: offer.canonicalUrl,
    merchantHost: offer.merchantHost,
    merchantName: offer.merchantName,
    productName: offer.productName,
    price: offer.price,
    availability: offer.availability,
    exaRequestId: offer.exaRequestId,
    retrievedAt: offer.retrievedAt,
    market,
    registeredAt: at,
  };
}

export const MAX_LINE_QUANTITY = 10;
export const MAX_LINES = 20;
export const MAX_TOTAL_MINOR = 99_999_999;
export const MIN_UNIT_MINOR = 50;

export type CartErrorCode =
  | "invalid-request"
  | "quantity-out-of-range"
  | "offer-not-registered"
  | "out-of-stock"
  | "invalid-price"
  | "below-minimum"
  | "currency-mismatch"
  | "quantity-limit"
  | "line-limit"
  | "total-too-large"
  | "not-in-cart";

export type CheckoutErrorCode = "cart-empty" | "checkout-not-configured" | "checkout-failed";

export type CartOp =
  | { kind: "add"; offerId: string; quantity: number; replace: boolean }
  | { kind: "setQuantity"; offerId: string; quantity: number }
  | { kind: "remove"; offerId: string }
  | { kind: "clear" };

export interface CurrencyMismatch {
  cartCurrency: Currency;
  offerCurrency: Currency;
}

export type CartResult =
  | { ok: true; cart: Cart }
  | { ok: false; code: "currency-mismatch"; details: CurrencyMismatch }
  | { ok: false; code: Exclude<CartErrorCode, "currency-mismatch"> };

export type OfferRegistry = (offerId: string) => RegisteredOffer | undefined;

const SHA256_K = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
);

type Words8 = [number, number, number, number, number, number, number, number];

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Synchronous SHA-256 so src/core also bundles for the browser (it has no node:crypto types). */
function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((bytes.length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);

  let h: Words8 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const [h0, h1, h2, h3, h4, h5, h6, h7] = h;
    h = [h0 + a, h1 + b, h2 + c, h3 + d, h4 + e, h5 + f, h6 + g, h7 + hh].map((v) => v >>> 0) as Words8;
  }
  return Array.from(h, (v) => v.toString(16).padStart(8, "0")).join("");
}

export function offerId(offer: {
  canonicalUrl: string;
  price: { amount: number; currency: string };
  exaRequestId: string;
  retrievedAt: string;
}): string {
  const joined = [offer.canonicalUrl, offer.price.currency, String(offer.price.amount), offer.exaRequestId, offer.retrievedAt].join("\n");
  return sha256Hex(joined);
}

export function toMinorUnits(amount: number, currency: string): number | null {
  if (!Number.isFinite(amount) || amount <= 0 || !isSupportedCurrency(currency)) return null;
  const digits = MINOR_DIGITS[currency];
  const scaled = amount * 10 ** digits;
  const minor = Math.round(scaled);
  const tolerance = digits === 0 ? 0 : 1e-6;
  return Math.abs(scaled - minor) <= tolerance && Number.isSafeInteger(minor) ? minor : null;
}

export function cartTotalMinor(cart: Pick<Cart, "lines">): number {
  return cart.lines.reduce((sum, line) => sum + line.demoUnitAmountMinor * line.quantity, 0);
}

export const emptyCart = (version: number): Cart => ({ version, currency: null, lines: [] });

type ParsedCartOp = { ok: true; op: CartOp } | { ok: false; code: "invalid-request" | "quantity-out-of-range" };

const ALLOWED_KEYS: Record<CartOp["kind"], readonly string[]> = {
  add: ["kind", "offerId", "quantity", "replace"],
  setQuantity: ["kind", "offerId", "quantity"],
  remove: ["kind", "offerId"],
  clear: ["kind"],
};

const isQuantity = (q: number): boolean => Number.isInteger(q) && q >= 1 && q <= MAX_LINE_QUANTITY;

/**
 * `fixed` holds the fields a route decides itself (the op kind, the offer id in the path). A body that also
 * names one of them is ambiguous and is refused rather than overridden.
 */
export function parseCartOp(raw: unknown, fixed: Readonly<Record<string, unknown>> = {}): ParsedCartOp {
  const invalid = { ok: false, code: "invalid-request" } as const;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalid;
  if (Object.keys(fixed).some((key) => Object.hasOwn(raw, key))) return invalid;
  const body: Record<string, unknown> = { ...raw, ...fixed };
  const field = (key: string): unknown => (Object.hasOwn(body, key) ? body[key] : undefined);
  const kind = field("kind");
  if (kind !== "add" && kind !== "setQuantity" && kind !== "remove" && kind !== "clear") return invalid;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS[kind].includes(key))) return invalid;
  if (kind === "clear") return { ok: true, op: { kind } };
  const id = field("offerId");
  if (typeof id !== "string" || id === "") return invalid;
  if (kind === "remove") return { ok: true, op: { kind, offerId: id } };
  const quantity = field("quantity");
  if (quantity !== undefined && typeof quantity !== "number") return invalid;
  if (kind === "setQuantity") {
    if (quantity === undefined) return invalid;
    if (!isQuantity(quantity)) return { ok: false, code: "quantity-out-of-range" };
    return { ok: true, op: { kind, offerId: id, quantity } };
  }
  const replace = field("replace");
  if (replace !== undefined && typeof replace !== "boolean") return invalid;
  if (quantity !== undefined && !isQuantity(quantity)) return { ok: false, code: "quantity-out-of-range" };
  return { ok: true, op: { kind, offerId: id, quantity: quantity ?? 1, replace: replace ?? false } };
}

function applyAdd(cart: Cart, op: Extract<CartOp, { kind: "add" }>, registry: OfferRegistry): CartResult {
  const offer = registry(op.offerId);
  if (!offer) return { ok: false, code: "offer-not-registered" };
  if (offer.availability === "out_of_stock") return { ok: false, code: "out-of-stock" };
  const unit = toMinorUnits(offer.price.amount, offer.price.currency);
  if (unit === null) return { ok: false, code: "invalid-price" };
  if (unit < MIN_UNIT_MINOR) return { ok: false, code: "below-minimum" };

  const base: Cart = op.replace ? emptyCart(cart.version) : cart;
  if (base.currency !== null && base.currency !== offer.price.currency) {
    return { ok: false, code: "currency-mismatch", details: { cartCurrency: base.currency, offerCurrency: offer.price.currency } };
  }
  const { quantity } = op;
  const existing = base.lines.find((line) => line.offerId === offer.id);
  if (existing && existing.quantity + quantity > MAX_LINE_QUANTITY) return { ok: false, code: "quantity-limit" };
  if (!existing && base.lines.length >= MAX_LINES) return { ok: false, code: "line-limit" };

  const lines: CartLine[] = existing
    ? base.lines.map((line) => (line === existing ? { ...line, quantity: line.quantity + quantity } : line))
    : [
        ...base.lines,
        {
          offerId: offer.id,
          productName: offer.productName,
          merchantHost: offer.merchantHost,
          quantity,
          demoUnitAmountMinor: unit,
          observed: {
            amount: offer.price.amount,
            currency: offer.price.currency,
            retrievedAt: offer.retrievedAt,
            merchantHost: offer.merchantHost,
          },
        },
      ];
  if (cartTotalMinor({ lines }) > MAX_TOTAL_MINOR) return { ok: false, code: "total-too-large" };
  return { ok: true, cart: { version: cart.version + 1, currency: offer.price.currency, lines } };
}

function applySetQuantity(cart: Cart, op: Extract<CartOp, { kind: "setQuantity" }>): CartResult {
  const existing = cart.lines.find((line) => line.offerId === op.offerId);
  if (!existing) return { ok: false, code: "not-in-cart" };
  if (existing.quantity === op.quantity) return { ok: true, cart };
  const lines = cart.lines.map((line) => (line === existing ? { ...line, quantity: op.quantity } : line));
  if (cartTotalMinor({ lines }) > MAX_TOTAL_MINOR) return { ok: false, code: "total-too-large" };
  return { ok: true, cart: { ...cart, version: cart.version + 1, lines } };
}

function applyRemove(cart: Cart, op: Extract<CartOp, { kind: "remove" }>): CartResult {
  if (!cart.lines.some((line) => line.offerId === op.offerId)) return { ok: false, code: "not-in-cart" };
  const lines = cart.lines.filter((line) => line.offerId !== op.offerId);
  return { ok: true, cart: { version: cart.version + 1, currency: lines.length === 0 ? null : cart.currency, lines } };
}

export function applyCartOp(cart: Cart, op: CartOp, registry: OfferRegistry): CartResult {
  switch (op.kind) {
    case "add":
      return applyAdd(cart, op, registry);
    case "setQuantity":
      return applySetQuantity(cart, op);
    case "remove":
      return applyRemove(cart, op);
    case "clear":
      return cart.lines.length === 0 ? { ok: true, cart } : { ok: true, cart: emptyCart(cart.version + 1) };
  }
}

export interface StripeEventView {
  type: string;
  payment_status?: string;
}

export type TransitionableOrder = Pick<Order, "state" | "declinedAttempts" | "awaitingAsyncPayment" | "anomaly">;

export type UserEvent = { kind: "cancel" } | { kind: "supersede" };
export type OrderEvent = UserEvent | ({ kind: "stripe" } & StripeEventView);

export interface TransitionResult<T extends TransitionableOrder> {
  order: T;
  outcome: "applied" | "no-transition";
}

export function applyStripeEvent<T extends TransitionableOrder>(order: T, event: StripeEventView): TransitionResult<T> {
  const noChange: TransitionResult<T> = { order, outcome: "no-transition" };
  const leave = (state: OrderState, extra: Partial<TransitionableOrder> = {}): TransitionResult<T> => ({
    order: { ...order, state, awaitingAsyncPayment: false, ...extra },
    outcome: "applied",
  });
  const paid = (): TransitionResult<T> => {
    if (order.state === "paid") return noChange;
    return leave("paid", order.state === "open" ? {} : { anomaly: `completed-after-${order.state}` });
  };

  switch (event.type) {
    case "checkout.session.completed":
      if (event.payment_status === "paid") return paid();
      if (event.payment_status === "unpaid" && order.state === "open" && !order.awaitingAsyncPayment) {
        return { order: { ...order, awaitingAsyncPayment: true }, outcome: "applied" };
      }
      return noChange;
    case "checkout.session.async_payment_succeeded":
      return paid();
    case "checkout.session.async_payment_failed":
      return order.state === "open" ? leave("payment_failed") : noChange;
    case "checkout.session.expired":
      return order.state === "open" ? leave("expired") : noChange;
    case "payment_intent.payment_failed":
      return order.state === "open" ? { order: { ...order, declinedAttempts: order.declinedAttempts + 1 }, outcome: "applied" } : noChange;
    default:
      return noChange;
  }
}

function applyUserEvent<T extends TransitionableOrder>(order: T, event: UserEvent): TransitionResult<T> {
  if (order.state !== "open") return { order, outcome: "no-transition" };
  const to = event.kind === "cancel" ? "cancelled" : "expired";
  return { order: { ...order, state: to, awaitingAsyncPayment: false }, outcome: "applied" };
}

type Transitioning = Omit<Order, "state"> & { state: OrderState | null };

/** The only place an order's state, updatedAt and transition log change together. `order.state` null is a new order. */
export function recordTransition(order: Transitioning, to: OrderState, at: string, meta: { eventId?: string; reason?: Order["reason"] } = {}): Order {
  return {
    ...order,
    state: to,
    awaitingAsyncPayment: false,
    updatedAt: at,
    ...(meta.reason !== undefined && { reason: meta.reason }),
    transitions: [...order.transitions, { at, from: order.state, to, ...(meta.eventId !== undefined && { eventId: meta.eventId }) }],
  };
}

export type NewOrder = Omit<Order, "state" | "reason" | "anomaly" | "updatedAt" | "transitions" | "awaitingAsyncPayment" | "declinedAttempts">;

export function createOrder(fields: NewOrder, state: Extract<OrderState, "open" | "failed">, at: string): Order {
  return recordTransition({ ...fields, state: null, declinedAttempts: 0, awaitingAsyncPayment: false, updatedAt: at, transitions: [] }, state, at);
}

/** Applies one event to an order. A change of state is logged with its event id; a change of counters or flags only moves updatedAt. */
export function transitionOrder(order: Order, event: OrderEvent, at: string, eventId?: string): TransitionResult<Order> {
  const result = event.kind === "stripe" ? applyStripeEvent(order, event) : applyUserEvent(order, event);
  if (result.outcome === "no-transition") return result;
  const after = result.order;
  if (after.state === order.state) return { order: { ...after, updatedAt: at }, outcome: "applied" };
  const reason = event.kind === "supersede" ? "superseded" : undefined;
  return { order: recordTransition({ ...after, state: order.state }, after.state, at, { ...(eventId !== undefined && { eventId }), ...(reason && { reason }) }), outcome: "applied" };
}

/** An order as the API shows it: Stripe's event ids stay in the store and the server log. */
export function publicOrder(order: Order): Order {
  return { ...order, transitions: order.transitions.map((t) => ({ at: t.at, from: t.from, to: t.to })) };
}

export const CART_TITLE = "Simulated cart";
export const SIMULATION_BANNER = "Simulated purchase in a Stripe sandbox. No order is placed with any merchant and no real money moves.";
export const CHECKOUT_BUTTON_LABEL = "Checkout in Stripe sandbox";

export const ORDER_BADGE_LABELS: Record<OrderState, string> = {
  open: "Simulated · Open",
  paid: "Simulated · Paid",
  cancelled: "Simulated · Cancelled",
  expired: "Simulated · Expired",
  payment_failed: "Simulated · Payment failed",
  failed: "Simulated · Failed",
};

export const FORBIDDEN_UI_PHRASES = ["Order confirmed", "Order placed", "Thank you for your order", "Purchase complete", "has shipped"] as const;

export function formatMinor(minor: number, currency: Currency): string {
  const digits = MINOR_DIGITS[currency];
  return (minor / 10 ** digits).toFixed(digits);
}

export const demoPriceLabel = (unitMinor: number, currency: Currency): string =>
  `Demo checkout price ${formatMinor(unitMinor, currency)} ${currency}`;

export const observedPriceLabel = (observed: CartLine["observed"], localTime: string): string =>
  `Last observed ${observed.amount.toFixed(MINOR_DIGITS[observed.currency])} ${observed.currency} on ${observed.merchantHost}, ${localTime}`;

export const demoTotalLabel = (totalMinor: number, currency: Currency): string =>
  `Demo total ${formatMinor(totalMinor, currency)} ${currency}`;

export const paidLabel = (hosts: readonly string[]): string =>
  `Simulated payment received (Stripe sandbox). No order was placed with ${hosts.join(", ")}.`;
