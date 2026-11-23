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
  parseCartOp,
  toMinorUnits,
  demoPriceLabel,
  demoTotalLabel,
  observedPriceLabel,
  offerId,
  paidLabel,
  type Cart,
  type CartOp,
  type OfferRegistry,
  type OrderState,
  type RegisteredOffer,
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

  it.each(
    [completedPaid, asyncSucceeded].flatMap((event) =>
      STATES.filter((s) => s !== "open" && s !== "paid").map((from) => [event, from] as const),
    ),
  )("%o from %s pays and records the anomaly", (event, from) => {
    const result = applyStripeEvent(order(from), event);
    expect(result.outcome).toBe("applied");
    expect(result.order.state).toBe("paid");
    expect(result.order.anomaly).toBe(`completed-after-${from}`);
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
  it.each(
    [asyncFailed, expired].flatMap((event) => STATES.filter((s) => s !== "open").map((state) => [event, state] as const)),
  )("%o is no-transition from %s", (event, state) => {
    const o = order(state);
    expect(applyStripeEvent(o, event)).toEqual({ order: o, outcome: "no-transition" });
  });
});

describe("applyStripeEvent: payment_intent.payment_failed", () => {
  it("counts a decline while open and keeps the order open", () => {
    expect(applyStripeEvent(order("open", { declinedAttempts: 1 }), piFailed)).toEqual({
      order: order("open", { declinedAttempts: 2 }),
      outcome: "applied",
    });
  });
  it.each(STATES.filter((s) => s !== "open"))("is no-transition from %s", (state) => {
    const o = order(state);
    expect(applyStripeEvent(o, piFailed)).toEqual({ order: o, outcome: "no-transition" });
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

const offerFixture = (over: Partial<RegisteredOffer> = {}): RegisteredOffer => ({
  id: "o1",
  canonicalUrl: "https://shop.example.com/p/1",
  merchantHost: "shop.example.com",
  merchantName: "Shop",
  productName: "Widget",
  price: { amount: 19.9, currency: "SGD" },
  availability: "in_stock",
  exaRequestId: "req",
  retrievedAt: "2026-11-23T00:00:00.000Z",
  market: "SG",
  registeredAt: "2026-11-23T00:00:00.000Z",
  ...over,
});
const registryOf =
  (...offers: RegisteredOffer[]): OfferRegistry =>
  (id) =>
    offers.find((o) => o.id === id);
const empty: Cart = { version: 0, currency: null, lines: [] };
const mustParse = (raw: unknown): CartOp => {
  const parsed = parseCartOp(raw);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.code}`);
  return parsed.op;
};

describe("parseCartOp strict parsing", () => {
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
  ])("%s is invalid-request", (_name, raw) => {
    expect(parseCartOp(raw)).toEqual({ ok: false, code: "invalid-request" });
  });

  it.each([
    ["add NaN", { kind: "add", offerId: "x", quantity: NaN }],
    ["setQuantity 11", { kind: "setQuantity", offerId: "x", quantity: 11 }],
  ])("%s is quantity-out-of-range", (_name, raw) => {
    expect(parseCartOp(raw)).toEqual({ ok: false, code: "quantity-out-of-range" });
  });

  it("normalizes add defaults", () => {
    expect(parseCartOp({ kind: "add", offerId: "x" })).toEqual({ ok: true, op: { kind: "add", offerId: "x", quantity: 1, replace: false } });
  });

  it("ignores inherited properties", () => {
    const inheritedKind = Object.create({ kind: "clear" });
    expect(parseCartOp(inheritedKind)).toEqual({ ok: false, code: "invalid-request" });
    const inheritedOfferId = Object.assign(Object.create({ offerId: "x" }), { kind: "remove" });
    expect(parseCartOp(inheritedOfferId)).toEqual({ ok: false, code: "invalid-request" });
    const inheritedQuantity = Object.assign(Object.create({ quantity: 99 }), { kind: "add", offerId: "x" });
    expect(parseCartOp(inheritedQuantity)).toEqual({ ok: true, op: { kind: "add", offerId: "x", quantity: 1, replace: false } });
  });
});

describe("toMinorUnits", () => {
  it.each([
    [19.9, "SGD", 1990],
    [99.99, "USD", 9999],
    [39980, "JPY", 39980],
    [1e-9, "USD", 0],
    [0.005, "USD", null],
    [100.5, "JPY", null],
    [5, "EUR", null],
    [0, "USD", null],
  ])("%s %s is %s", (amount, currency, expected) => {
    expect(toMinorUnits(amount, currency)).toBe(expected);
  });
});

describe("applyCartOp", () => {
  const o1 = offerFixture();
  const reg = registryOf(o1, offerFixture({ id: "tiny", price: { amount: 1e-9, currency: "USD" }, market: "US" }));
  const addO1: CartOp = { kind: "add", offerId: "o1", quantity: 1, replace: false };

  it("adds a full line snapshot and bumps the version", () => {
    const result = applyCartOp({ ...empty, version: 3 }, addO1, reg);
    expect(result).toEqual({
      ok: true,
      cart: {
        version: 4,
        currency: "SGD",
        lines: [
          {
            offerId: "o1",
            productName: "Widget",
            merchantHost: "shop.example.com",
            quantity: 1,
            demoUnitAmountMinor: 1990,
            observed: { amount: 19.9, currency: "SGD", retrievedAt: "2026-11-23T00:00:00.000Z", merchantHost: "shop.example.com" },
          },
        ],
      },
    });
  });

  it("re-adding keeps the original line snapshot even when the registry changed", () => {
    const first = applyCartOp(empty, addO1, reg);
    if (!first.ok) throw new Error("add failed");
    const renamed = registryOf(offerFixture({ productName: "Renamed", merchantHost: "other.example.com" }));
    const second = applyCartOp(first.cart, addO1, renamed);
    expect(second).toMatchObject({ ok: true, cart: { version: 2, lines: [{ productName: "Widget", merchantHost: "shop.example.com", quantity: 2 }] } });
  });

  it("setQuantity and remove bump the version", () => {
    const first = applyCartOp({ ...empty, version: 5 }, addO1, reg);
    if (!first.ok) throw new Error("add failed");
    const set = applyCartOp(first.cart, mustParse({ kind: "setQuantity", offerId: "o1", quantity: 4 }), reg);
    expect(set).toMatchObject({ ok: true, cart: { version: 7, lines: [{ quantity: 4 }] } });
    if (!set.ok) throw new Error("set failed");
    expect(applyCartOp(set.cart, mustParse({ kind: "remove", offerId: "o1" }), reg)).toEqual({
      ok: true,
      cart: { version: 8, currency: null, lines: [] },
    });
  });

  it("reports a sub-cent price that rounds to zero as below-minimum", () => {
    expect(applyCartOp(empty, { kind: "add", offerId: "tiny", quantity: 1, replace: false }, reg)).toEqual({ ok: false, code: "below-minimum" });
  });

  it("reports an unregistered offer", () => {
    expect(applyCartOp(empty, { kind: "add", offerId: "x", quantity: 1, replace: false }, () => undefined)).toEqual({
      ok: false,
      code: "offer-not-registered",
    });
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
    expect(FORBIDDEN_UI_PHRASES.filter((phrase) => copy.includes(phrase))).toEqual([]);
  });
});

describe("offerId", () => {
  const base = { canonicalUrl: "https://a.example/p", price: { amount: 1.5, currency: "USD" }, exaRequestId: "req", retrievedAt: "2026-11-23T00:00:00.000Z" };
  it.each(["", "https://a.example/p", `https://b.example/${"x".repeat(55)}`, `https://c.example/${"ヨ".repeat(40)}`, "y".repeat(300)])(
    "is the SHA-256 of the newline-joined fields for url %#",
    (canonicalUrl) => {
      const joined = [canonicalUrl, "USD", "1.5", "req", base.retrievedAt].join("\n");
      expect(offerId({ ...base, canonicalUrl })).toBe(createHash("sha256").update(joined, "utf8").digest("hex"));
    },
  );
  it("changes with the price", () => {
    expect(offerId({ ...base, price: { amount: 1.6, currency: "USD" } })).not.toBe(offerId(base));
  });
});
