import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckoutOrderInput, CheckoutSessionOptions, CheckoutSessionParams } from "../../src/commerce/port";
import { buildCheckoutSessionRequest } from "../../src/commerce/session-request";
import { StripeCheckoutPort } from "../../src/commerce/stripe-port";
import type { StripeClientLike } from "../../src/commerce/stripe-port";
import { testSecretKey } from "../commerce/keys";

interface Case {
  id: string;
  input: { port: number; now: string; order: CheckoutOrderInput };
  expected: { params: CheckoutSessionParams; options: CheckoutSessionOptions };
}

const cases = (JSON.parse(readFileSync(join(import.meta.dirname, "../../evals/cases/checkout-session-request.json"), "utf8")) as { cases: Case[] }).cases;

describe("EV-019 checkout session request", () => {
  it("loads all 4 frozen cases", () => {
    expect(cases.map((c) => c.id)).toEqual(["R01", "R02", "R03", "R04"]);
  });

  it.each(cases)("builder output deep-equals case $id", (c) => {
    expect(buildCheckoutSessionRequest(c.input.order, { port: c.input.port, now: new Date(c.input.now) })).toEqual(c.expected);
  });

  it("StripeCheckoutPort passes exactly the built params and options to sessions.create", async () => {
    const seen: { params: unknown; options: unknown }[] = [];
    const client = {
      checkout: {
        sessions: {
          create: async (params: unknown, options: unknown) => {
            seen.push({ params, options });
            return { id: "cs_test_stub", url: "https://checkout.stripe.com/c/pay/cs_test_stub", status: "open", livemode: false, amount_total: 1, currency: "usd" };
          },
          expire: async () => ({}),
          retrieve: async () => ({}),
        },
      },
    } as unknown as StripeClientLike;
    const port = new StripeCheckoutPort(testSecretKey(), () => client);
    for (const c of cases) {
      const request = buildCheckoutSessionRequest(c.input.order, { port: c.input.port, now: new Date(c.input.now) });
      await port.createSession(request.params, request.options);
    }
    expect(seen).toHaveLength(cases.length);
    expect(seen).toEqual(cases.map((c) => c.expected));
  });
});
