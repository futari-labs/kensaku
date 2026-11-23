import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cartTotalMinor, offerId, toMinorUnits } from "../../src/core";
import type { Cart, CartLine, Currency, Market } from "../../src/core";
import { readJson } from "../core/fixtures";
import { commerceRig, registrable } from "../commerce/rig";
import type { Rig } from "../commerce/rig";

interface OfferFixture {
  id?: string;
  canonicalUrl: string;
  merchantHost: string;
  merchantName: string;
  productName: string;
  price: { amount: number; currency: Currency };
  availability: "in_stock" | "out_of_stock" | "preorder" | "unknown";
  exaRequestId: string;
  retrievedAt: string;
}
interface CartCase {
  id: string;
  start?: { offer: string; quantity: number }[];
  startGenerated?: { count: number; amount: number; currency: Currency };
  op: { kind: string; offer?: string; offerId?: string; quantity?: number; replace?: boolean; extraFields?: Record<string, unknown> };
  expected:
    | { outcome: "ok"; cart?: { currency: Currency | null; lines: { offer: string; quantity: number; demoUnitAmountMinor: number }[]; totalMinor: number }; lineQuantity?: { offerId: string; quantity: number } }
    | { outcome: "error"; code: string; details?: unknown };
}
const rules = readJson<{ offers: Record<string, OfferFixture>; registered: string[]; unregisteredOfferId: string; cartCases: CartCase[] }>("evals/cases/commerce-rules.json");

const STATUS: Record<string, number> = {
  "invalid-request": 400,
  "quantity-out-of-range": 400,
  "offer-not-registered": 404,
  "currency-mismatch": 409,
  "out-of-stock": 422,
  "invalid-price": 422,
  "below-minimum": 422,
  "quantity-limit": 422,
  "line-limit": 422,
  "total-too-large": 422,
  "not-in-cart": 404,
};
const MARKET: Record<Currency, Market> = { USD: "US", SGD: "SG", JPY: "JP" };

const idOf = (name: string): string => {
  const o = rules.offers[name];
  if (!o) throw new Error(`unknown offer ${name}`);
  return o.id ?? offerId(o);
};
const generated = (n: number, g: { amount: number; currency: Currency }): OfferFixture => ({
  canonicalUrl: `https://gen.example.com/p/${n}`,
  merchantHost: "gen.example.com",
  merchantName: "Generated",
  productName: `Generated ${n}`,
  price: { amount: g.amount, currency: g.currency },
  availability: "in_stock",
  exaRequestId: "req_gen",
  retrievedAt: "2026-11-23T00:00:00.000Z",
});

function register(rig: Rig, o: OfferFixture): string {
  const id = o.id ?? offerId(o);
  rig.offers.register([registrable({ ...o, id })], MARKET[o.price.currency]);
  return id;
}
function lineOf(o: OfferFixture, quantity: number): CartLine {
  return {
    offerId: o.id ?? offerId(o),
    productName: o.productName,
    merchantHost: o.merchantHost,
    quantity,
    demoUnitAmountMinor: toMinorUnits(o.price.amount, o.price.currency)!,
    observed: { amount: o.price.amount, currency: o.price.currency, retrievedAt: o.retrievedAt, merchantHost: o.merchantHost },
  };
}

describe("EV-018 cart cases through the routes", () => {
  it("runs all 34 cases", () => expect(rules.cartCases).toHaveLength(34));

  it.each(rules.cartCases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const gen = c.startGenerated ? Array.from({ length: c.startGenerated.count }, (_, i) => generated(i + 1, c.startGenerated!)) : [];
    const startLines = c.startGenerated
      ? gen.map((o) => lineOf(o, 1))
      : (c.start ?? []).map((l) => lineOf({ ...rules.offers[l.offer]!, id: idOf(l.offer) }, l.quantity));
    const cart: Cart = { version: 7, currency: startLines[0]?.observed.currency ?? null, lines: startLines };
    const rig = commerceRig({ seed: { version: 1, cart, orders: [], processedEvents: [] } });
    for (const name of rules.registered) register(rig, { ...rules.offers[name]!, id: idOf(name) });
    for (const o of gen) register(rig, o);

    const { offer, offerId: placeholder, extraFields, kind, ...rest } = c.op;
    let id: string | undefined;
    if (offer !== undefined) id = idOf(offer);
    else if (placeholder === "UNREGISTERED") id = rules.unregisteredOfferId;
    else if (placeholder?.startsWith("GEN-")) id = offerId(gen[Number(placeholder.slice(4)) - 1]!);

    const res =
      kind === "add"
        ? await rig.json("POST", "/api/cart/items", { ...rest, ...(id && { offerId: id }), ...extraFields })
        : kind === "setQuantity"
          ? await rig.json("PATCH", `/api/cart/items/${id}`, rest)
          : kind === "remove"
            ? await rig.json("DELETE", `/api/cart/items/${id}`)
            : await rig.json("DELETE", "/api/cart");

    if (c.expected.outcome === "error") {
      expect(res.status).toBe(STATUS[c.expected.code]);
      expect(res.body.code).toBe(c.expected.code);
      expect(res.body.details).toEqual(c.expected.details);
      expect((await rig.json("GET", "/api/cart")).body.cart).toEqual(cart);
      return;
    }
    expect(res.status).toBe(200);
    const after = await rig.json("GET", "/api/cart");
    const got = after.body.cart as Cart;
    expect(res.body.cart).toEqual(got);
    const { cart: want, lineQuantity } = c.expected;
    if (want) {
      expect(got.currency).toBe(want.currency);
      expect(got.lines.map((l) => ({ offer: l.offerId, quantity: l.quantity, demoUnitAmountMinor: l.demoUnitAmountMinor }))).toEqual(want.lines.map((l) => ({ ...l, offer: idOf(l.offer) })));
      expect(after.body.totalMinor).toBe(want.totalMinor);
      expect(cartTotalMinor(got)).toBe(want.totalMinor);
    }
    if (lineQuantity) expect(got.lines.find((l) => l.offerId === offerId(gen[Number(lineQuantity.offerId.slice(4)) - 1]!))?.quantity).toBe(lineQuantity.quantity);
  });
});

describe("cart route boundaries", () => {
  const seeded = () => {
    const rig = commerceRig();
    const o = rules.offers["US-A"]!;
    register(rig, { ...o, id: idOf("US-A") });
    return { rig, id: idOf("US-A") };
  };

  it("rejects a body that names a kind, on POST and PATCH", async () => {
    const { rig, id } = seeded();
    expect((await rig.json("POST", "/api/cart/items", { kind: "clear" })).status).toBe(400);
    await rig.json("POST", "/api/cart/items", { offerId: id });
    expect((await rig.json("PATCH", `/api/cart/items/${id}`, { kind: "remove", quantity: 2 })).status).toBe(400);
  });

  it("takes the offer id of PATCH from the path and rejects one in the body", async () => {
    const { rig, id } = seeded();
    await rig.json("POST", "/api/cart/items", { offerId: id });
    const res = await rig.json("PATCH", `/api/cart/items/${id}`, { offerId: "x", quantity: 2 });
    expect(res).toMatchObject({ status: 400, body: { code: "invalid-request" } });
  });

  it("answers invalid-request to a body that is not JSON or not an object", async () => {
    const { rig } = seeded();
    for (const body of ["nope", "[1]", "null"]) {
      expect((await rig.request("/api/cart/items", { method: "POST", body })).status).toBe(400);
    }
  });

  it("does not turn an offer id into a file path", async () => {
    const { rig } = seeded();
    const res = await rig.json("POST", "/api/cart/items", { offerId: "../../../etc/passwd" });
    expect(res).toMatchObject({ status: 404, body: { code: "offer-not-registered" } });
  });

  it("answers 503 commerce-unavailable on every commerce route and still serves research, when the state file is corrupt", async () => {
    const first = commerceRig();
    mkdirSync(join(first.dir, "data"), { recursive: true });
    const file = join(first.dir, "data", "state.json");
    writeFileSync(file, '{"version":1,"cart":');
    const rig = first.restart();
    for (const [method, path] of [["GET", "/api/cart"], ["POST", "/api/cart/items"], ["POST", "/api/checkout"], ["GET", "/api/orders"], ["POST", "/api/stripe/webhook"]] as const) {
      expect(await rig.json(method, path, method === "POST" ? {} : undefined), path).toMatchObject({ status: 503, body: { code: "commerce-unavailable" } });
    }
    expect(readFileSync(file, "utf8")).toBe('{"version":1,"cart":');
    expect(rig.logs).toContainEqual(expect.objectContaining({ event: "commerce_disabled" }));
    expect((await rig.harness.chat()).status).toBe(200);
  });

  it("GET /api/cart reports checkoutConfigured and /api/health keeps its v1.1 shape", async () => {
    const { rig } = seeded();
    expect((await rig.json("GET", "/api/cart")).body).toEqual({ cart: { version: 0, currency: null, lines: [] }, totalMinor: 0, checkoutConfigured: true });
    expect((await rig.json("GET", "/api/health")).body).toEqual({ ok: true, exaConfigured: false, mode: "fixture" });
    const off = commerceRig({ port: undefined });
    expect((await off.json("GET", "/api/cart")).body.checkoutConfigured).toBe(false);
  });
});
