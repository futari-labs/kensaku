import { describe, expect, it } from "vitest";
import { FakeCheckoutPort } from "../../src/commerce/fake-port";
import type { CheckoutSessionParams } from "../../src/commerce/port";
import { StripeCheckoutPort, signTestPayload, verifyWebhook } from "../../src/commerce/stripe-port";
import type { StripeClientLike } from "../../src/commerce/stripe-port";
import { testSecretKey, testWebhookSecret } from "./keys";

const params = { mode: "payment", line_items: [{ quantity: 2, price_data: { currency: "usd", unit_amount: 500 } }] } as unknown as CheckoutSessionParams;
const options = { idempotencyKey: "kensaku-order-x" };

describe("verifyWebhook", () => {
  const secret = testWebhookSecret();
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", livemode: false, data: { object: {} } });
  const now = () => Math.floor(Date.now() / 1000);

  it("returns the event for a valid signature", () => {
    expect(verifyWebhook(payload, signTestPayload(payload, secret, now()), secret).id).toBe("evt_1");
  });

  it("rejects a wrong secret, a stale timestamp, a tampered body, and a missing header", () => {
    const other = "whsec" + "_" + "zzzzzzzzzzzzzzzzzzzz";
    expect(() => verifyWebhook(payload, signTestPayload(payload, other, now()), secret)).toThrow(expect.objectContaining({ code: "invalid-signature" }));
    expect(() => verifyWebhook(payload, signTestPayload(payload, secret, now() - 400), secret)).toThrow(expect.objectContaining({ code: "invalid-signature" }));
    expect(() => verifyWebhook(payload + " ", signTestPayload(payload, secret, now()), secret)).toThrow(expect.objectContaining({ code: "invalid-signature" }));
    expect(() => verifyWebhook(payload, "", secret)).toThrow(expect.objectContaining({ code: "invalid-signature" }));
  });

  it("accepts a timestamp inside the 300 s tolerance", () => {
    expect(verifyWebhook(payload, signTestPayload(payload, secret, now() - 250), secret).id).toBe("evt_1");
  });
});

describe("StripeCheckoutPort errors", () => {
  const failing = (): StripeClientLike => {
    const boom = async () => {
      throw new Error("Invalid API Key provided: sk_test_****abcd");
    };
    return { checkout: { sessions: { create: boom, expire: boom, retrieve: boom } } } as unknown as StripeClientLike;
  };

  it("surfaces every SDK failure as one stripe-error without the SDK message", async () => {
    const port = new StripeCheckoutPort(testSecretKey(), failing);
    for (const run of [() => port.createSession(params, options), () => port.expireSession("cs_1"), () => port.retrieveSession("cs_1")]) {
      const error = await run().catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "stripe-error", message: "stripe-error" });
    }
  });
});

describe("FakeCheckoutPort", () => {
  it("creates open sessions on the local hosted page and records calls", async () => {
    const fake = new FakeCheckoutPort(8787);
    const session = await fake.createSession(params, options);
    expect(session).toMatchObject({ status: "open", livemode: false, amountTotal: 1000, currency: "usd" });
    expect(session.url).toBe(`http://127.0.0.1:8787/__test/checkout/${session.id}`);
    expect(fake.calls).toEqual([{ method: "createSession", params, options }]);
  });

  it("plays scripted create outcomes", async () => {
    const fake = new FakeCheckoutPort(8787);
    fake.setScript({ createSession: "livemode" });
    expect((await fake.createSession(params, options)).livemode).toBe(true);
    fake.setScript({ createSession: "url:https://evil.example.com/pay" });
    expect((await fake.createSession(params, options)).url).toBe("https://evil.example.com/pay");
    fake.setScript({ createSession: "error" });
    await expect(fake.createSession(params, options)).rejects.toMatchObject({ code: "stripe-error" });
  });

  it("plays scripted expire and retrieve outcomes", async () => {
    const fake = new FakeCheckoutPort(8787);
    await expect(fake.expireSession("cs_1")).resolves.toBeUndefined();
    fake.setScript({ expireSession: "error", retrieveSession: "complete" });
    await expect(fake.expireSession("cs_1")).rejects.toMatchObject({ code: "stripe-error" });
    expect((await fake.retrieveSession("cs_1")).status).toBe("complete");
    fake.setScript({ retrieveSession: "error" });
    await expect(fake.retrieveSession("cs_1")).rejects.toMatchObject({ code: "stripe-error" });
    expect(fake.count("expireSession")).toBe(2);
    expect(fake.count("retrieveSession")).toBe(2);
  });

  it("holds an ok-delayed expire until released", async () => {
    const fake = new FakeCheckoutPort(8787);
    fake.setScript({ expireSession: "ok-delayed" });
    let done = false;
    const pending = fake.expireSession("cs_1").then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false);
    fake.releaseDelayed();
    await pending;
    expect(done).toBe(true);
  });
});
