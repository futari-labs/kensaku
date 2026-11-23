import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckoutOrderInput, CheckoutSessionOptions, CheckoutSessionParams } from "../../src/commerce/port";
import { buildCheckoutSessionRequest } from "../../src/commerce/session-request";
import { StripeCheckoutPort } from "../../src/commerce/stripe-port";
import { stubClient, stubSession } from "../commerce/stub-client";

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
    const port = new StripeCheckoutPort(
      stubClient({
        create: async (params, options) => {
          seen.push({ params, options });
          return stubSession();
        },
      }),
    );
    for (const c of cases) {
      const request = buildCheckoutSessionRequest(c.input.order, { port: c.input.port, now: new Date(c.input.now) });
      await port.createSession(request.params, request.options);
    }
    expect(seen).toHaveLength(cases.length);
    expect(seen).toEqual(cases.map((c) => c.expected));
  });
});
