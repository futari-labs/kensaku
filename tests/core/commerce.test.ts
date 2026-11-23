import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CART_TITLE,
  CHECKOUT_BUTTON_LABEL,
  FORBIDDEN_UI_PHRASES,
  ORDER_BADGE_LABELS,
  SIMULATION_BANNER,
  applyCartOp,
  applyStripeEvent,
  demoPriceLabel,
  demoTotalLabel,
  observedPriceLabel,
  offerId,
  paidLabel,
  type Cart,
  type OrderState,
  type StripeEventView,
  type TransitionableOrder,
} from "../../src/core";

const STATES: OrderState[] = ["open", "paid", "cancelled", "expired", "payment_failed", "failed"];
const order = (state: OrderState, extra: Partial<TransitionableOrder> = {}): TransitionableOrder => ({
  state,
  declinedAttempts: 0,
  awaitingAsyncPayment: false,
  ...extra,
});

const completedPaid: StripeEventView = { type: "checkout.session.completed", payment_status: "paid" };
const completedUnpaid: StripeEventView = { type: "checkout.session.completed", payment_status: "unpaid" };
const completedFree: StripeEventView = { type: "checkout.session.completed", payment_status: "no_payment_required" };
const asyncSucceeded: StripeEventView = { type: "checkout.session.async_payment_succeeded", payment_status: "paid" };
const asyncFailed: StripeEventView = { type: "checkout.session.async_payment_failed", payment_status: "unpaid" };
const expired: StripeEventView = { type: "checkout.session.expired" };
const piFailed: StripeEventView = { type: "payment_intent.payment_failed" };

describe("applyStripeEvent: paid events", () => {
  it.each([completedPaid, asyncSucceeded])("$type pays an open order without an anomaly", (event) => {
    const result = applyStripeEvent(order("open"), event);
    expect(result).toEqual({ order: order("open", { state: "paid" }), outcome: "applied" });
    expect(result.order.anomaly).toBeUndefined();
  });

  it.each([completedPaid, asyncSucceeded])("$type from a non-open, non-paid state pays and records the anomaly", (event) => {
    for (const from of STATES.filter((s) => s !== "open" && s !== "paid")) {
      const result = applyStripeEvent(order(from), event);
      expect(result.outcome).toBe("applied");
      expect(result.order.state).toBe("paid");
      expect(result.order.anomaly).toBe(`completed-after-${from}`);
    }
  });

  it.each([completedPaid, asyncSucceeded])("$type on a paid order is no-transition", (event) => {
    const paid = order("paid");
    expect(applyStripeEvent(paid, event)).toEqual({ order: paid, outcome: "no-transition" });
  });

  it("paying clears awaitingAsyncPayment", () => {
    expect(applyStripeEvent(order("open", { awaitingAsyncPayment: true }), asyncSucceeded).order).toMatchObject({
      state: "paid",
      awaitingAsyncPayment: false,
    });
  });
});

describe("applyStripeEvent: completed with other payment statuses", () => {
  it("unpaid keeps the order open and sets awaitingAsyncPayment", () => {
    expect(applyStripeEvent(order("open"), completedUnpaid)).toEqual({
      order: order("open", { awaitingAsyncPayment: true }),
      outcome: "applied",
    });
  });
  it("unpaid again changes nothing", () => {
    const waiting = order("open", { awaitingAsyncPayment: true });
    expect(applyStripeEvent(waiting, completedUnpaid)).toEqual({ order: waiting, outcome: "no-transition" });
  });
  it.each(STATES.filter((s) => s !== "open"))("unpaid on a %s order is no-transition", (state) => {
    const o = order(state);
    expect(applyStripeEvent(o, completedUnpaid)).toEqual({ order: o, outcome: "no-transition" });
  });
  it.each(STATES)("no_payment_required on a %s order is no-transition", (state) => {
    const o = order(state);
    expect(applyStripeEvent(o, completedFree)).toEqual({ order: o, outcome: "no-transition" });
  });
});

describe("applyStripeEvent: async_payment_failed and expired", () => {
  it.each([
    [asyncFailed, "payment_failed"],
    [expired, "expired"],
  ] as const)("%o moves an open order to %s and stops awaiting", (event, to) => {
    expect(applyStripeEvent(order("open", { awaitingAsyncPayment: true }), event)).toEqual({
      order: order("open", { state: to }),
      outcome: "applied",
    });
  });
  it.each([asyncFailed, expired])("$type is no-transition from every terminal state", (event) => {
    for (const state of STATES.filter((s) => s !== "open")) {
      const o = order(state);
      expect(applyStripeEvent(o, event)).toEqual({ order: o, outcome: "no-transition" });
    }
  });
});

describe("applyStripeEvent: payment_intent.payment_failed", () => {
  it("counts a decline while open and keeps the order open", () => {
    expect(applyStripeEvent(order("open", { declinedAttempts: 1 }), piFailed)).toEqual({
      order: order("open", { declinedAttempts: 2 }),
      outcome: "applied",
    });
  });
  it("is no-transition from every terminal state", () => {
    for (const state of STATES.filter((s) => s !== "open")) {
      const o = order(state);
      expect(applyStripeEvent(o, piFailed)).toEqual({ order: o, outcome: "no-transition" });
    }
  });
});

describe("applyStripeEvent: purity and unknown types", () => {
  it("returns no-transition for any other type", () => {
    const o = order("open");
    expect(applyStripeEvent(o, { type: "customer.created" })).toEqual({ order: o, outcome: "no-transition" });
  });
  it("never mutates its input and preserves extra order fields", () => {
    const o = Object.freeze({ ...order("open"), orderId: "ord_A" });
    const result = applyStripeEvent(o, completedPaid);
    expect(result.order).toMatchObject({ orderId: "ord_A", state: "paid" });
    expect(o.state).toBe("open");
  });
});

describe("applyCartOp strict parsing", () => {
  const empty: Cart = { version: 0, currency: null, lines: [] };
  const none = new Map();
  it.each([
    ["non-object", "add"],
    ["null", null],
    ["array", []],
    ["unknown kind", { kind: "buy", offerId: "x" }],
    ["missing offerId", { kind: "add" }],
    ["empty offerId", { kind: "add", offerId: "" }],
    ["string quantity", { kind: "add", offerId: "x", quantity: "2" }],
    ["non-boolean replace", { kind: "add", offerId: "x", replace: "yes" }],
    ["unknown field", { kind: "remove", offerId: "x", price: 1 }],
    ["clear with a field", { kind: "clear", offerId: "x" }],
    ["setQuantity without quantity", { kind: "setQuantity", offerId: "x" }],
  ])("%s is invalid-request", (_name, op) => {
    expect(applyCartOp(empty, op, none)).toEqual({ ok: false, code: "invalid-request" });
  });

  it("checks quantity range before registration", () => {
    expect(applyCartOp(empty, { kind: "add", offerId: "x", quantity: NaN }, none)).toEqual({ ok: false, code: "quantity-out-of-range" });
    expect(applyCartOp(empty, { kind: "setQuantity", offerId: "x", quantity: 11 }, none)).toEqual({ ok: false, code: "quantity-out-of-range" });
  });

  it("accepts a registry lookup function", () => {
    expect(applyCartOp(empty, { kind: "add", offerId: "x" }, () => undefined)).toEqual({ ok: false, code: "offer-not-registered" });
  });
});

describe("labels", () => {
  it("states the fixed copy", () => {
    expect(CART_TITLE).toBe("Simulated cart");
    expect(SIMULATION_BANNER).toBe("Simulated purchase in a Stripe sandbox. No order is placed with any merchant and no real money moves.");
    expect(CHECKOUT_BUTTON_LABEL).toBe("Checkout in Stripe sandbox");
  });
  it("formats demo prices by currency exponent", () => {
    expect(demoPriceLabel(1990, "SGD")).toBe("Demo checkout price 19.90 SGD");
    expect(demoPriceLabel(39980, "JPY")).toBe("Demo checkout price 39980 JPY");
    expect(demoTotalLabel(42799, "USD")).toBe("Demo total 427.99 USD");
  });
  it("labels the observed price with host and local time", () => {
    const observed = { amount: 99.99, currency: "USD", retrievedAt: "2026-11-23T02:00:00.000Z", merchantHost: "shop.example.com" } as const;
    expect(observedPriceLabel(observed, "23 Nov 2026, 10:00")).toBe("Last observed 99.99 USD on shop.example.com, 23 Nov 2026, 10:00");
  });
  it("lists every merchant host in the paid label", () => {
    expect(paidLabel(["a.com", "b.com"])).toBe("Simulated payment received (Stripe sandbox). No order was placed with a.com, b.com.");
  });
  it("badges every state as simulated and never uses forbidden phrases", () => {
    expect(Object.keys(ORDER_BADGE_LABELS).sort()).toEqual([...STATES].sort());
    const copy = [...Object.values(ORDER_BADGE_LABELS), SIMULATION_BANNER, CART_TITLE, CHECKOUT_BUTTON_LABEL, paidLabel(["a.com"])].join("\n");
    for (const phrase of FORBIDDEN_UI_PHRASES) expect(copy).not.toContain(phrase);
  });
});

describe("offerId", () => {
  const base = { canonicalUrl: "https://a.example/p", price: { amount: 1.5, currency: "USD" }, exaRequestId: "req", retrievedAt: "2026-11-23T00:00:00.000Z" };
  it("is the SHA-256 of the newline-joined fields, for any length and non-ASCII text", () => {
    for (const canonicalUrl of ["", "https://a.example/p", `https://b.example/${"x".repeat(55)}`, `https://c.example/${"ヨ".repeat(40)}`, "y".repeat(300)]) {
      const offer = { ...base, canonicalUrl };
      const joined = [canonicalUrl, "USD", "1.5", "req", base.retrievedAt].join("\n");
      expect(offerId(offer)).toBe(createHash("sha256").update(joined, "utf8").digest("hex"));
    }
  });
  it("changes with the price", () => {
    expect(offerId({ ...base, price: { amount: 1.6, currency: "USD" } })).not.toBe(offerId(base));
  });
});
