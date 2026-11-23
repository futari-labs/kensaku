import { describe, expect, it } from "vitest";
import { applyCartOp, cartTotalMinor, offerId, parseCartOp, toMinorUnits, type Cart, type CartLine, type CartResult, type Currency, type RegisteredOffer } from "../../src/core";
import { readJson } from "../core/fixtures";

interface OfferFixture {
  id?: string;
  canonicalUrl: string;
  merchantHost: string;
  merchantName: string;
  productName: string;
  price: { amount: number; currency: Currency };
  availability: RegisteredOffer["availability"];
  exaRequestId: string;
  retrievedAt: string;
}
interface ExpectedCart {
  currency: Currency | null;
  lines: { offer: string; quantity: number; demoUnitAmountMinor: number }[];
  totalMinor: number;
}
interface CartCase {
  id: string;
  start?: { offer: string; quantity: number }[];
  startGenerated?: { count: number; amount: number; currency: Currency };
  op: { kind: string; offer?: string; offerId?: string; quantity?: number; replace?: boolean; extraFields?: Record<string, unknown> };
  expected:
    | { outcome: "ok"; cart?: ExpectedCart; lineQuantity?: { offerId: string; quantity: number } }
    | { outcome: "error"; code: string; details?: unknown; cartUnchanged: true };
}
interface Rules {
  offers: Record<string, OfferFixture>;
  registered: string[];
  unregisteredOfferId: string;
  offerIdCases: { id: string; offer: string }[];
  minorUnitCases: { id: string; amount: number; currency: string; expected: number | "invalid" }[];
  cartCases: CartCase[];
  snapshotCases: { id: string; offer: string; expectedLine: { demoUnitAmountMinor: number; observed: CartLine["observed"] } }[];
  versionCases: { id: string; startVersion: number; start: { offer: string; quantity: number }[]; op: CartCase["op"]; expectedVersion: number }[];
}
const rules = readJson<Rules>("evals/cases/commerce-rules.json");

function run(cart: Cart, raw: unknown, reg: ReadonlyMap<string, RegisteredOffer>): CartResult {
  const parsed = parseCartOp(raw);
  return parsed.ok ? applyCartOp(cart, parsed.op, (id) => reg.get(id)) : { ok: false, code: parsed.code };
}

const MARKET = { USD: "US", SGD: "SG", JPY: "JP" } as const;
const register = (o: OfferFixture, id: string): RegisteredOffer => ({
  id,
  canonicalUrl: o.canonicalUrl,
  merchantHost: o.merchantHost,
  merchantName: o.merchantName,
  productName: o.productName,
  price: o.price,
  availability: o.availability,
  exaRequestId: o.exaRequestId,
  retrievedAt: o.retrievedAt,
  market: MARKET[o.price.currency],
  registeredAt: o.retrievedAt,
});
const idOf = (name: string): string => {
  const o = rules.offers[name];
  if (!o) throw new Error(`unknown offer ${name}`);
  return o.id ?? offerId(o);
};
const generated = (n: number, g: { amount: number; currency: Currency }): RegisteredOffer => {
  const o: OfferFixture = {
    canonicalUrl: `https://gen.example.com/p/${n}`,
    merchantHost: "gen.example.com",
    merchantName: "Generated",
    productName: `Generated ${n}`,
    price: { amount: g.amount, currency: g.currency },
    availability: "in_stock",
    exaRequestId: "req_gen",
    retrievedAt: "2026-11-23T00:00:00.000Z",
  };
  return register(o, offerId(o));
};

const registry = new Map<string, RegisteredOffer>();
for (const name of rules.registered) registry.set(idOf(name), register(rules.offers[name]!, idOf(name)));
const genRegistry = (g: { count: number; amount: number; currency: Currency }): RegisteredOffer[] =>
  Array.from({ length: g.count }, (_, i) => generated(i + 1, g));

function lineOf(o: RegisteredOffer, quantity: number): CartLine {
  return {
    offerId: o.id,
    productName: o.productName,
    merchantHost: o.merchantHost,
    quantity,
    demoUnitAmountMinor: toMinorUnits(o.price.amount, o.price.currency)!,
    observed: { amount: o.price.amount, currency: o.price.currency, retrievedAt: o.retrievedAt, merchantHost: o.merchantHost },
  };
}
function cartOf(lines: CartLine[], version = 0): Cart {
  return { version, currency: lines[0]?.observed.currency ?? null, lines };
}
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function opBody(op: CartCase["op"], gen: RegisteredOffer[]): Record<string, unknown> {
  const { offer, offerId: placeholder, extraFields, ...rest } = op;
  let id: string | undefined;
  if (offer !== undefined) id = idOf(offer);
  else if (placeholder === "UNREGISTERED") id = rules.unregisteredOfferId;
  else if (placeholder?.startsWith("GEN-")) id = gen[Number(placeholder.slice(4)) - 1]?.id;
  else if (placeholder !== undefined) throw new Error(`unknown placeholder ${placeholder}`);
  return { ...rest, ...(id === undefined ? {} : { offerId: id }), ...extraFields };
}

describe("EV-018 offerId", () => {
  it("evaluates every case in the frozen file", () => {
    expect(rules.offerIdCases.length).toBe(4);
  });
  it.each(rules.offerIdCases.map((c) => [c.id, c] as const))("%s matches the precomputed id", (_id, c) => {
    const o = rules.offers[c.offer]!;
    expect(o.id).toMatch(/^[0-9a-f]{64}$/);
    expect(offerId(o)).toBe(o.id);
  });
});

describe("EV-018 minor units", () => {
  it("evaluates every case in the frozen file", () => {
    expect(rules.minorUnitCases.length).toBe(11);
  });
  it.each(rules.minorUnitCases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(toMinorUnits(c.amount, c.currency)).toBe(c.expected === "invalid" ? null : c.expected);
  });
});

describe("EV-018 cart operations", () => {
  it("evaluates every case in the frozen file", () => {
    expect(rules.cartCases.length).toBe(34);
  });
  it.each(rules.cartCases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const gen = c.startGenerated ? genRegistry(c.startGenerated) : [];
    const reg = new Map(registry);
    for (const g of gen) reg.set(g.id, g);
    const start = deepFreeze(
      cartOf(c.startGenerated ? gen.map((g) => lineOf(g, 1)) : (c.start ?? []).map((l) => lineOf(reg.get(idOf(l.offer))!, l.quantity)), 7),
    );
    const before = structuredClone(start);

    const result = run(start, opBody(c.op, gen), reg);

    expect(start).toEqual(before);
    if (c.expected.outcome === "error") {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(c.expected.code);
      expect("details" in result ? result.details : undefined).toEqual(c.expected.details);
      return;
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { cart, lineQuantity } = c.expected;
    if (cart) {
      expect(result.cart.currency).toBe(cart.currency);
      expect(result.cart.lines.map((l) => ({ offer: l.offerId, quantity: l.quantity, demoUnitAmountMinor: l.demoUnitAmountMinor }))).toEqual(
        cart.lines.map((l) => ({ ...l, offer: idOf(l.offer) })),
      );
      expect(cartTotalMinor(result.cart)).toBe(cart.totalMinor);
    }
    if (lineQuantity) {
      const id = gen[Number(lineQuantity.offerId.slice(4)) - 1]!.id;
      expect(result.cart.lines.find((l) => l.offerId === id)?.quantity).toBe(lineQuantity.quantity);
    }
  });
});

describe("EV-018 cart version", () => {
  it("evaluates every case in the frozen file", () => {
    expect(rules.versionCases.length).toBe(6);
  });
  it.each(rules.versionCases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const start = cartOf(c.start.map((l) => lineOf(registry.get(idOf(l.offer))!, l.quantity)), c.startVersion);
    const result = run(start, opBody(c.op, []), registry);
    expect(result.ok ? result.cart.version : start.version).toBe(c.expectedVersion);
  });
});

describe("EV-018 line snapshot", () => {
  it("evaluates every case in the frozen file", () => {
    expect(rules.snapshotCases.length).toBe(2);
  });
  it.each(rules.snapshotCases.map((c) => [c.id, c] as const))("%s copies the registered price next to the observed price", (_id, c) => {
    const result = run(cartOf([]), { kind: "add", offerId: idOf(c.offer) }, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = result.cart.lines[0]!;
    expect(line.demoUnitAmountMinor).toBe(c.expectedLine.demoUnitAmountMinor);
    expect(line.observed).toEqual(c.expectedLine.observed);
  });
});
