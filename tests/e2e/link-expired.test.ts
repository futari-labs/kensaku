import { describe, expect, it } from "vitest";
import type { Order } from "../../src/core/commerce";
import { hostsOf, linkExpired } from "../../src/web/app/returnView";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");
const order = (state: Order["state"], expiresAt: string | null): Order => ({
  orderId: "ord_1",
  state,
  currency: "USD",
  lines: [],
  totalMinor: 1000,
  cartVersion: 1,
  stripeSessionId: "cs_1",
  expiresAt,
  declinedAttempts: 0,
  awaitingAsyncPayment: false,
  createdAt: "t",
  updatedAt: "t",
  transitions: [],
});

describe("linkExpired", () => {
  it("is true only for an open order whose expiry has passed", () => {
    expect(linkExpired(order("open", "2026-01-01T11:59:59.000Z"), NOW)).toBe(true);
    expect(linkExpired(order("open", "2026-01-01T12:00:00.000Z"), NOW)).toBe(true);
    expect(linkExpired(order("open", "2026-01-01T12:00:01.000Z"), NOW)).toBe(false);
    expect(linkExpired(order("open", null), NOW)).toBe(false);
  });

  it("is false once the order has left open", () => {
    for (const state of ["paid", "cancelled", "expired", "failed", "payment_failed"] as const) expect(linkExpired(order(state, "2026-01-01T00:00:00.000Z"), NOW)).toBe(false);
  });
});

describe("hostsOf", () => {
  it("lists each merchant host once, in line order", () => {
    const line = (merchantHost: string) => ({ merchantHost }) as Order["lines"][number];
    expect(hostsOf([line("a.example"), line("b.example"), line("a.example")])).toEqual(["a.example", "b.example"]);
  });
});
