import type Stripe from "stripe";
import { buildCheckoutSessionRequest } from "../../src/commerce/session-request";
import type { StripeClientLike } from "../../src/commerce/stripe-port";

type Sessions = StripeClientLike["checkout"]["sessions"];

/** A sandbox open session; override any field the test cares about. */
export function stubSession(overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_stub",
    url: "https://checkout.stripe.com/c/pay/cs_test_stub",
    status: "open",
    livemode: false,
    amount_total: 100,
    currency: "usd",
    ...overrides,
  } as Stripe.Checkout.Session;
}

/** The one SDK stub: every method answers with an open sandbox session unless a handler is given. */
export function stubClient(handlers: Partial<Sessions> = {}): StripeClientLike {
  const sessions: Sessions = {
    create: async () => stubSession(),
    expire: async () => ({}),
    retrieve: async () => stubSession(),
    ...handlers,
  };
  return { checkout: { sessions } };
}

/** Builder output for a one-line order: 2 x 500 minor units. */
export const { params, options } = buildCheckoutSessionRequest(
  {
    orderId: "ord_1",
    currency: "usd",
    lines: [
      {
        productName: "Widget",
        merchantHost: "shop.example.com",
        quantity: 2,
        demoUnitAmountMinor: 500,
        observed: { amount: 500, currency: "USD", retrievedAt: "2026-01-01T00:00:00Z", merchantHost: "shop.example.com" },
      },
    ],
  },
  { port: 8787, now: new Date("2026-01-01T00:00:00Z") },
);
