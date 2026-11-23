import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { FakeCheckoutPort } from "../../src/commerce/fake-port";
import { StripeCheckoutPort, signTestPayload, verifyWebhook } from "../../src/commerce/stripe-port";
import { testSecretKey, testWebhookSecret } from "./keys";
import { options, params, stubClient } from "./stub-client";

describe("verifyWebhook", () => {
  const secret = testWebhookSecret();
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", livemode: false, data: { object: {} } });
  const now = () => Math.floor(Date.now() / 1000);

  const sign = (body: string, at = now()) => signTestPayload(body, secret, at);
  const code = (c: string) => expect.objectContaining({ code: c });

  it("returns the narrowed event for a valid signature", () => {
    const body = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      livemode: false,
      created: 1,
      data: { object: { id: "cs_1", client_reference_id: "ord_1", payment_status: "paid", metadata: { a: "b" }, extra: 1 } },
    });
    expect(verifyWebhook(body, sign(body), secret)).toEqual({
      id: "evt_1",
      type: "checkout.session.completed",
      livemode: false,
      object: { id: "cs_1", client_reference_id: "ord_1", payment_status: "paid", metadata: { a: "b" } },
    });
  });

  it("verifies raw bytes too", () => {
    expect(verifyWebhook(new TextEncoder().encode(payload), sign(payload), secret).id).toBe("evt_1");
  });

  it("rejects a wrong secret, a stale timestamp, a tampered body, and a missing or empty header", () => {
    const other = "whsec" + "_" + "zzzzzzzzzzzzzzzzzzzz";
    expect(() => verifyWebhook(payload, signTestPayload(payload, other, now()), secret)).toThrow(code("invalid-signature"));
    expect(() => verifyWebhook(payload, sign(payload, now() - 400), secret)).toThrow(code("invalid-signature"));
    expect(() => verifyWebhook(payload + " ", sign(payload), secret)).toThrow(code("invalid-signature"));
    expect(() => verifyWebhook(payload, "", secret)).toThrow(code("invalid-signature"));
    expect(() => verifyWebhook(payload, undefined, secret)).toThrow(code("invalid-signature"));
  });

  it("accepts a timestamp inside the 300 s tolerance", () => {
    expect(verifyWebhook(payload, sign(payload, now() - 250), secret).id).toBe("evt_1");
  });

  it.each(["[1,2,3]", "null", '"str"', "not json", "{}", '{"id":"e","type":"t","livemode":false}', '{"id":"e","type":"t","livemode":"no","data":{"object":{}}}'])(
    "treats a correctly signed body %s as invalid-payload, not invalid-signature",
    (body) => {
      expect(() => verifyWebhook(body, sign(body), secret)).toThrow(code("invalid-payload"));
    },
  );
});

describe("StripeCheckoutPort errors", () => {
  const failing = () => {
    const boom = async () => {
      throw new Error("Invalid API Key provided: sk_test_****abcd");
    };
    return stubClient({ create: boom, expire: boom, retrieve: boom });
  };

  it("surfaces every SDK failure as one stripe-error without the SDK message", async () => {
    const port = new StripeCheckoutPort(failing());
    for (const run of [() => port.createSession(params, options), () => port.expireSession("cs_1"), () => port.retrieveSession("cs_1")]) {
      const error = await run().catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "stripe-error", message: "stripe-error" });
    }
  });
});

describe("StripeCheckoutPort.fromSecretKey", () => {
  it("builds the SDK client with the pinned version, timeout, and no retries", () => {
    const client: unknown = Reflect.get(StripeCheckoutPort.fromSecretKey(testSecretKey()), "client");
    if (!(client instanceof Stripe)) throw new Error("expected a Stripe client");
    expect(client.getApiField("version")).toBe("2026-10-28.endive");
    expect(client.getApiField("timeout")).toBe(10000);
    expect(client.getApiField("maxNetworkRetries")).toBe(0);
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
    await expect(fake.createSession(params, options)).rejects.toMatchObject({ code: "livemode-refused" });
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

  it("holds every ok-delayed expire until released", async () => {
    const fake = new FakeCheckoutPort(8787);
    fake.setScript({ expireSession: "ok-delayed" });
    let done = 0;
    const pending = ["cs_1", "cs_2"].map((id) =>
      fake.expireSession(id).then(() => {
        done++;
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(0);
    fake.releaseDelayed();
    await Promise.all(pending);
    expect(done).toBe(2);
  });
});
