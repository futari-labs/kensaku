import { describe, expect, it } from "vitest";
import type { Order } from "../../src/core/commerce";
import type { CheckoutReturn, Reply } from "../../src/web/app/commerce";
import { returnViewOf } from "../../src/web/app/returnView";

const order = (state: Order["state"], extra: Partial<Order> = {}): Reply<Order> => ({
  ok: true,
  value: { orderId: "ord_1", state, currency: "USD", lines: [], totalMinor: 1000, cartVersion: 1, stripeSessionId: "cs_1", expiresAt: null, declinedAttempts: 0, awaitingAsyncPayment: false, createdAt: "t", updatedAt: "t", transitions: [], ...extra },
});
const fail = (status: number, code: string): Reply<Order> => ({ ok: false, status, code });
const success: CheckoutReturn = { outcome: "success", orderId: "ord_1", sessionId: "cs_1" };
const cancelled: CheckoutReturn = { outcome: "cancelled", orderId: "ord_1", sessionId: undefined };

describe("returnViewOf", () => {
  it("confirms while the order is open or unread, and shows paid once it is", () => {
    expect(returnViewOf(success, undefined, undefined).kind).toBe("confirming");
    expect(returnViewOf(success, undefined, order("open")).kind).toBe("confirming");
    expect(returnViewOf(success, undefined, order("paid"))).toMatchObject({ kind: "paid" });
  });

  it("stops on an unknown checkout: a 404 or a session id that is not the order's", () => {
    expect(returnViewOf(success, undefined, fail(404, "order-not-found")).kind).toBe("unknown");
    expect(returnViewOf({ ...success, sessionId: "cs_other" }, undefined, order("paid")).kind).toBe("unknown");
  });

  it("shows each ended state as its own view", () => {
    for (const state of ["expired", "failed", "payment_failed"] as const) expect(returnViewOf(success, undefined, order(state))).toEqual({ kind: "ended", state });
  });

  it("waits for the cancel reply, then shows cancelled with the decline note", () => {
    expect(returnViewOf(cancelled, undefined, undefined).kind).toBe("pending");
    expect(returnViewOf(cancelled, order("cancelled", { declinedAttempts: 1 }), undefined)).toEqual({ kind: "cancelled", declined: true });
    expect(returnViewOf(cancelled, order("cancelled"), undefined)).toEqual({ kind: "cancelled", declined: false });
  });

  it("never calls a paid order cancelled, and says so when the cancel failed on an open order", () => {
    expect(returnViewOf(cancelled, fail(409, "already-paid"), order("paid")).kind).toBe("paid");
    expect(returnViewOf(cancelled, fail(502, "cancel-failed"), order("open")).kind).toBe("cancel-failed");
    expect(returnViewOf(cancelled, fail(409, "already-completed"), order("open")).kind).toBe("confirming");
    expect(returnViewOf(cancelled, fail(404, "order-not-found"), fail(404, "order-not-found")).kind).toBe("unknown");
  });
});
