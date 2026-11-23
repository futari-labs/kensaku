import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFER_TTL_MS, OfferStore } from "../../src/commerce/registry";
import { PORT_TIMEOUT_MS } from "../../src/commerce/service";
import { stripeEventEnvelope } from "../../src/commerce/stripe-port";
import { CommerceStore, emptyState } from "../../src/commerce/store";
import { PROCESSED_MAX, PROCESSED_TTL_MS, recordProcessed } from "../../src/commerce/webhook";
import type { CartLine, CommerceState, Order } from "../../src/core/commerce";
import { commerceRig, registrable } from "./rig";

afterEach(() => vi.useRealTimers());

const ID = "a".repeat(64);
const line: CartLine = {
  offerId: ID,
  productName: "Widget",
  merchantHost: "shop.example.com",
  quantity: 1,
  demoUnitAmountMinor: 1000,
  observed: { amount: 10, currency: "USD", retrievedAt: "2026-11-23T00:00:00.000Z", merchantHost: "shop.example.com" },
};
const withCart: CommerceState = { ...emptyState(), cart: { version: 1, currency: "USD", lines: [line] } };

describe("the Stripe call timeout", () => {
  it("answers 502 when a port call outlasts it, and frees the queue for the next operation", async () => {
    vi.useFakeTimers();
    const rig = commerceRig({ seed: withCart });
    rig.port.createSession = () => new Promise(() => {});
    const hung = rig.json("POST", "/api/checkout", {});
    const behind = rig.json("PATCH", `/api/cart/items/${ID}`, { quantity: 2 });
    await vi.advanceTimersByTimeAsync(PORT_TIMEOUT_MS - 1);
    expect(rig.service.orders()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(await hung).toMatchObject({ status: 502, body: { code: "checkout-failed" } });
    expect(rig.service.orders()[0]).toMatchObject({ state: "failed", stripeSessionId: null });
    expect((await behind).status).toBe(200);
    expect(rig.service.cart().cart.lines[0]?.quantity).toBe(2);
  });

  it("answers 502 cancel-failed when expire and retrieve both hang", async () => {
    vi.useFakeTimers();
    const order: Order = {
      orderId: "ord_1",
      state: "open",
      currency: "USD",
      lines: [line],
      totalMinor: 1000,
      cartVersion: 1,
      stripeSessionId: "cs_1",
      expiresAt: null,
      declinedAttempts: 0,
      awaitingAsyncPayment: false,
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
      transitions: [],
    };
    const rig = commerceRig({ seed: { ...withCart, orders: [order] } });
    rig.port.expireSession = () => new Promise(() => {});
    rig.port.retrieveSession = () => new Promise(() => {});
    const cancelled = rig.json("POST", "/api/orders/ord_1/cancel", {});
    await vi.advanceTimersByTimeAsync(2 * PORT_TIMEOUT_MS + 10);
    expect(await cancelled).toMatchObject({ status: 502, body: { code: "cancel-failed" } });
    expect(rig.service.order("ord_1")?.state).toBe("open");
  });
});

const openOrder = (n: number): Order => ({
  orderId: `ord_${n}`,
  state: "open",
  currency: "USD",
  lines: [line],
  totalMinor: 1000,
  cartVersion: 1,
  stripeSessionId: `cs_${n}`,
  expiresAt: null,
  declinedAttempts: 0,
  awaitingAsyncPayment: false,
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
  transitions: [{ at: "2026-11-23T00:00:00.000Z", from: null, to: "open" }],
});

describe("checkout with open orders and webhooks", () => {
  it("supersedes every open order, oldest first, before creating the new session", async () => {
    const rig = commerceRig({ seed: { ...withCart, orders: [openOrder(1), openOrder(2)] } });
    expect((await rig.json("POST", "/api/checkout", {})).status).toBe(200);
    expect(rig.port.calls.filter((c) => c.method === "expireSession").map((c) => (c as { id: string }).id)).toEqual(["cs_1", "cs_2"]);
    expect(rig.port.calls.map((c) => c.method)).toEqual(["expireSession", "expireSession", "createSession"]);
    expect(rig.service.order("ord_1")).toMatchObject({ state: "expired", reason: "superseded" });
    expect(rig.service.order("ord_2")).toMatchObject({ state: "expired", reason: "superseded" });
    expect(rig.service.order("ord_1")?.transitions.map((t) => t.to)).toEqual(["open", "expired"]);
    expect(rig.service.orders()[0]?.state).toBe("open");
  });

  it("applies a webhook that arrives during a delayed checkout create only after the checkout finishes", async () => {
    const rig = commerceRig({ seed: withCart });
    let release: () => void = () => {};
    let entered = false;
    const create = rig.port.createSession.bind(rig.port);
    rig.port.createSession = async (params, options) => {
      entered = true;
      await new Promise<void>((resolve) => (release = resolve));
      return create(params, options);
    };
    const checkout = rig.json("POST", "/api/checkout", {});
    await vi.waitFor(() => expect(entered).toBe(true));
    let answered = false;
    const payload = JSON.stringify(stripeEventEnvelope("evt_during", "checkout.session.expired", { id: "cs_other", client_reference_id: "ord_missing" }));
    const delivery = rig.signed(payload).then((res) => {
      answered = true;
      return res;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(answered).toBe(false);
    release();
    expect((await checkout).status).toBe(200);
    expect(await (await delivery).json()).toEqual({ outcome: "unknown-order" });
    expect(rig.service.orders()).toHaveLength(1);
  });
});

describe("processed webhook ids", () => {
  const now = new Date("2026-11-23T00:00:00.000Z");

  it("drops ids older than 30 days", () => {
    const old = { id: "old", at: new Date(now.getTime() - PROCESSED_TTL_MS - 1).toISOString() };
    const edge = { id: "edge", at: new Date(now.getTime() - PROCESSED_TTL_MS).toISOString() };
    expect(recordProcessed([old, edge], "new", now).map((e) => e.id)).toEqual(["edge", "new"]);
  });

  it("keeps the newest 10000, dropping the oldest first", () => {
    const events = Array.from({ length: PROCESSED_MAX }, (_, i) => ({ id: `evt_${i}`, at: now.toISOString() }));
    const next = recordProcessed(events, "evt_last", now);
    expect(next).toHaveLength(PROCESSED_MAX);
    expect(next[0]?.id).toBe("evt_1");
    expect(next.at(-1)?.id).toBe("evt_last");
  });
});

describe("the state file", () => {
  it("is written atomically: the saved state loads back and no temporary file is left", () => {
    const rig = commerceRig();
    const store = new CommerceStore(join(rig.dir, "state"));
    store.save(withCart);
    expect(store.load()).toEqual({ ok: true, state: withCart });
    expect(readdirSync(join(rig.dir, "state"))).toEqual(["state.json"]);
  });

  it("is an empty state when absent, and not-ok (file untouched) when invalid", () => {
    const rig = commerceRig();
    const dir = join(rig.dir, "state");
    expect(new CommerceStore(dir).load()).toEqual({ ok: true, state: emptyState() });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "state.json"), JSON.stringify({ ...emptyState(), version: 2 }));
    expect(new CommerceStore(dir).load().ok).toBe(false);
  });

  it("persists every cart change, so a restart sees the cart", async () => {
    const rig = commerceRig();
    rig.offers.register([registrable({ id: ID, price: { amount: 10, currency: "USD" } })], "US");
    expect((await rig.json("POST", "/api/cart/items", { offerId: ID, quantity: 3 })).status).toBe(200);
    const again = rig.restart();
    expect(again.service.cart().cart.lines).toMatchObject([{ offerId: ID, quantity: 3, demoUnitAmountMinor: 1000 }]);
  });
});

describe("the offer registry", () => {
  const clock = { now: new Date("2026-11-23T00:00:00.000Z") };
  const store = (dir: string) => new OfferStore({ dir, clock: () => clock.now });

  it("stores a snapshot, refreshes registeredAt on re-registration, and prunes entries unregistered for 30 days", () => {
    const rig = commerceRig();
    const dir = join(rig.dir, "reg");
    const registry = store(dir);
    const a = registrable({ id: "a".repeat(64), price: { amount: 10, currency: "USD" } });
    const b = registrable({ id: "b".repeat(64), price: { amount: 20, currency: "USD" } });
    registry.register([a, b], "US");
    expect(registry.get(a.id!)).toMatchObject({ id: a.id, market: "US", registeredAt: clock.now.toISOString() });

    clock.now = new Date(clock.now.getTime() + OFFER_TTL_MS - 1000);
    registry.register([a], "US");
    expect(registry.get(a.id!)?.registeredAt).toBe(clock.now.toISOString());
    expect(registry.get(b.id!)).toBeDefined();

    clock.now = new Date(clock.now.getTime() + 2000);
    registry.prune();
    expect(registry.get(b.id!)).toBeUndefined();
    expect(registry.get(a.id!)).toBeDefined();
    expect(existsSync(join(dir, `${b.id}.json`))).toBe(false);
  });

  it("skips offers without an id and refuses an id that is not a SHA-256 hex digest", () => {
    const rig = commerceRig();
    const registry = store(join(rig.dir, "reg2"));
    registry.register([{ ...registrable({ id: "x", price: { amount: 1, currency: "USD" } }), id: undefined }], "US");
    expect(registry.get("../x")).toBeUndefined();
    expect(registry.get("x")).toBeUndefined();
  });
});
