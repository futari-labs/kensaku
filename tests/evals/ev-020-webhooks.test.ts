import { describe, expect, it } from "vitest";
import { StripeCheckoutPort, signTestPayload } from "../../src/commerce/stripe-port";
import type { FakeScript } from "../../src/commerce/fake-port";
import type { CartLine, CommerceState, Order, OrderState } from "../../src/core/commerce";
import { readJson } from "../core/fixtures";
import { commerceRig } from "../commerce/rig";
import type { Rig } from "../commerce/rig";
import { stubClient, stubSession } from "../commerce/stub-client";

interface Delivery {
  event?: string;
  template?: string;
  override?: Record<string, unknown>;
  rawBody?: string;
  signature?: "valid" | "wrong-secret" | "stale" | "missing" | "tampered";
  restart?: true;
  expect?: { status: number; outcome: string };
}
interface WebhookCase {
  id: string;
  startState?: OrderState;
  cartVersionAtDelivery?: number;
  deliveries: Delivery[];
  final: { state?: OrderState; cartCleared?: boolean; paidTransitions?: number; declinedAttempts?: number; anomaly?: string; awaitingAsyncPayment?: boolean };
}
interface Step {
  call?: "cancel" | "checkout" | "checkout-concurrent-pair" | "cancel-with-concurrent-delivery";
  orderId?: string;
  port?: { expireSession?: string; retrieveSession?: string; createSession?: string };
  deliver?: Delivery;
  expect: Record<string, unknown>;
}
interface RouteCase {
  id: string;
  startState?: OrderState;
  noBaseOrder?: true;
  cart?: "empty" | "nonEmpty";
  checkoutConfigured?: false;
  livePortWithStubbedSdk?: true;
  steps: Step[];
}
interface Cases {
  baseOrder: { orderId: string; stripeSessionId: string; currency: "USD"; totalMinor: number; state: OrderState; cartVersion: number; declinedAttempts: number };
  baseCartVersion: number;
  templates: Record<string, { type: string; object: Record<string, unknown> }>;
  webhookCases: WebhookCase[];
  routeCases: RouteCase[];
}
const cases = readJson<Cases>("evals/cases/webhook-events.json");

const NOW = "2026-11-23T04:00:00.000Z";
const line = (offerId: string, unit: number): CartLine => ({
  offerId,
  productName: "Widget",
  merchantHost: "shop.example.com",
  quantity: 1,
  demoUnitAmountMinor: unit,
  observed: { amount: unit / 100, currency: "USD", retrievedAt: NOW, merchantHost: "shop.example.com" },
});
const LINES = [line("a", 32800), line("b", 9999)];

function seed(options: { state?: OrderState; noOrder?: boolean; cartVersion: number; cartEmpty?: boolean }): CommerceState {
  const { baseOrder } = cases;
  const order: Order = {
    orderId: baseOrder.orderId,
    state: options.state ?? baseOrder.state,
    currency: baseOrder.currency,
    lines: LINES,
    totalMinor: baseOrder.totalMinor,
    cartVersion: baseOrder.cartVersion,
    stripeSessionId: baseOrder.stripeSessionId,
    expiresAt: "2026-11-23T05:00:00.000Z",
    declinedAttempts: baseOrder.declinedAttempts,
    awaitingAsyncPayment: false,
    createdAt: NOW,
    updatedAt: NOW,
    transitions: [{ at: NOW, from: null, to: "open" }],
  };
  return {
    version: 1,
    cart: options.cartEmpty ? { version: options.cartVersion, currency: null, lines: [] } : { version: options.cartVersion, currency: "USD", lines: LINES },
    orders: options.noOrder ? [] : [order],
    processedEvents: [],
  };
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const [head, ...rest] = path.split(".");
  if (rest.length === 0) {
    target[head!] = value;
    return;
  }
  const inner = (target[head!] ??= {}) as Record<string, unknown>;
  setPath(inner, rest.join("."), value);
}

function bodyOf(d: Delivery): string {
  if (d.rawBody !== undefined) return d.rawBody;
  const template = cases.templates[d.template!]!;
  const event: Record<string, unknown> = {
    id: d.event,
    object: "event",
    api_version: "2026-10-28.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: template.type,
    data: { object: structuredClone(template.object) },
  };
  for (const [path, value] of Object.entries(d.override ?? {})) setPath(event, path.startsWith("object.") ? `data.${path}` : path, value);
  return JSON.stringify(event);
}

function post(rig: Rig, d: Delivery): Promise<Response> {
  const payload = bodyOf(d);
  const now = Math.floor(Date.now() / 1000);
  const headers = {
    valid: () => signTestPayload(payload, rig.secret, now),
    "wrong-secret": () => signTestPayload(payload, `whsec_${"z9y8x7w6v5u4t3s2r1q0".repeat(2)}`, now),
    stale: () => signTestPayload(payload, rig.secret, now - 400),
    tampered: () => signTestPayload(payload, rig.secret, now),
    missing: () => undefined,
  };
  const header = headers[d.signature ?? "valid"]();
  const sent = d.signature === "tampered" ? payload.replace("evt_", "evt-") : payload;
  return rig.request("/api/stripe/webhook", { method: "POST", body: sent, ...(header !== undefined && { headers: { "stripe-signature": header } }) });
}

const orderOf = async (rig: Rig, id: string): Promise<Order> => ((await rig.json("GET", `/api/orders/${id}`)).body.order as Order);
const cartLines = async (rig: Rig): Promise<number> => ((await rig.json("GET", "/api/cart")).body.cart as { lines: unknown[] }).lines.length;

describe("EV-020 webhook cases", () => {
  it("covers all 30 cases", () => expect(cases.webhookCases).toHaveLength(30));

  it.each(cases.webhookCases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    let rig = commerceRig({
      seed: seed({ ...(c.startState && { state: c.startState }), cartVersion: c.cartVersionAtDelivery ?? cases.baseCartVersion }),
    });
    for (const d of c.deliveries) {
      if (d.restart) {
        rig = rig.restart();
        continue;
      }
      const res = await post(rig, d);
      expect({ status: res.status, body: await res.json() }, `${c.id} ${d.event ?? "raw"}`).toEqual({ status: d.expect!.status, body: { outcome: d.expect!.outcome } });
    }
    const order = await orderOf(rig, cases.baseOrder.orderId);
    const { final } = c;
    if (final.state !== undefined) expect(order.state).toBe(final.state);
    if (final.declinedAttempts !== undefined) expect(order.declinedAttempts).toBe(final.declinedAttempts);
    if (final.anomaly !== undefined) expect(order.anomaly).toBe(final.anomaly);
    if (final.awaitingAsyncPayment !== undefined) expect(order.awaitingAsyncPayment).toBe(final.awaitingAsyncPayment);
    if (final.paidTransitions !== undefined) expect(order.transitions.filter((t) => t.to === "paid")).toHaveLength(final.paidTransitions);
    if (final.cartCleared !== undefined) expect((await cartLines(rig)) === 0).toBe(final.cartCleared);
  });
});

const scriptOf = (port: Step["port"]): FakeScript => (port ?? {}) as FakeScript;

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
}

describe("EV-020 route cases", () => {
  it("covers all 19 cases", () => expect(cases.routeCases).toHaveLength(19));

  it.each(cases.routeCases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const noOrder = c.noBaseOrder === true;
    const livePort = c.livePortWithStubbedSdk
      ? new StripeCheckoutPort(stubClient({ create: async () => stubSession({ url: c.steps[0]!.port!.createSession!.replace(/^url:/, "") }) }))
      : undefined;
    const rig = commerceRig({
      seed: seed({ ...(c.startState && { state: c.startState }), noOrder, cartVersion: cases.baseCartVersion, cartEmpty: c.cart === "empty" }),
      ...(c.checkoutConfigured === false && { port: undefined }),
      ...(livePort && { port: livePort }),
    });
    const base = cases.baseOrder.orderId;
    const cartBefore = JSON.stringify((await rig.json("GET", "/api/cart")).body.cart);

    for (const step of c.steps) {
      rig.port.setScript(scriptOf(step.port));
      const want = step.expect;
      const newestOther = async () => (await rig.service.orders()).find((o) => o.orderId !== base);

      if (step.call === "cancel") {
        const res = await rig.json("POST", `/api/orders/${step.orderId ?? base}/cancel`, {});
        expect(res.status).toBe(want.status);
        if (want.code !== undefined) expect(res.body.code).toBe(want.code);
        if (want.state !== undefined) expect((await orderOf(rig, base)).state).toBe(want.state);
      } else if (step.call === "checkout") {
        const res = await rig.json("POST", "/api/checkout", {});
        expect(res.status).toBe(want.status);
        if (want.code !== undefined) expect(res.body.code).toBe(want.code);
        if (want.urlReturned !== undefined) expect(res.body.url !== undefined).toBe(want.urlReturned);
        if (want.priorOrderState !== undefined) expect((await orderOf(rig, base)).state).toBe(want.priorOrderState);
        if (want.priorOrderReason !== undefined) expect((await orderOf(rig, base)).reason).toBe(want.priorOrderReason);
        if (want.newOrderState !== undefined) expect((await newestOther())?.state).toBe(want.newOrderState);
        if (want.cartUnchanged) expect(JSON.stringify((await rig.json("GET", "/api/cart")).body.cart)).toBe(cartBefore);
      } else if (step.call === "checkout-concurrent-pair") {
        const [a, b] = await Promise.all([rig.json("POST", "/api/checkout", {}), rig.json("POST", "/api/checkout", {})]);
        expect([a.status, b.status]).toEqual(want.statuses);
        const [first, second] = rig.service.orders().toReversed();
        expect({ state: first?.state, reason: first?.reason }).toEqual({ state: want.firstOrderState, reason: want.firstOrderReason });
        expect(second?.state).toBe(want.secondOrderState);
      } else if (step.call === "cancel-with-concurrent-delivery") {
        const cancel = rig.json("POST", `/api/orders/${base}/cancel`, {});
        await waitFor(() => rig.port.count("expireSession") === 1);
        let delivered = false;
        const delivery = post(rig, step.deliver!).then(async (res) => {
          delivered = true;
          return { status: res.status, body: (await res.json()) as { outcome: string } };
        });
        await settle();
        expect(delivered).toBe(false);
        rig.port.releaseDelayed();
        const [cancelled, reply] = await Promise.all([cancel, delivery]);
        expect(cancelled.status).toBe(want.cancelStatus);
        expect(reply.status).toBe(want.deliveryStatus);
        expect(reply.body.outcome).toBe(want.deliveryOutcome);
        expect((await orderOf(rig, base)).state).toBe(want.state);
      } else if (step.deliver !== undefined) {
        const res = await post(rig, step.deliver);
        expect(res.status).toBe(want.status);
        expect(((await res.json()) as { outcome: string }).outcome).toBe(want.outcome);
        expect((await orderOf(rig, base)).state).toBe(want.state);
      }

      if (!c.livePortWithStubbedSdk) {
        if (want.expireCalls !== undefined) expect(rig.port.count("expireSession")).toBe(want.expireCalls);
        if (want.retrieveCalls !== undefined) expect(rig.port.count("retrieveSession")).toBe(want.retrieveCalls);
        if (want.createCalls !== undefined) expect(rig.port.count("createSession")).toBe(want.createCalls);
      }
    }
  });
});
