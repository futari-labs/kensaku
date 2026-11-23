import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CheckoutPortError } from "../../src/commerce/port";
import { StripeCheckoutPort } from "../../src/commerce/stripe-port";
import { ConfigError, parseConfig } from "../../src/server/config";
import { liveSecretKey, testSecretKey, testWebhookSecret } from "../commerce/keys";
import { options, params, stubClient, stubSession } from "../commerce/stub-client";

const ROOT = join(import.meta.dirname, "../..");

function configError(env: Record<string, string>): ConfigError {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("EV-021 check 1: parseConfig refuses non-sandbox Stripe values", () => {
  const goodSecret = testWebhookSecret();

  it.each([
    ["a live secret key", liveSecretKey("sk_live_")],
    ["a live restricted key", liveSecretKey("rk_live_")],
    ["a key containing _live_", testSecretKey("sk_test_") + "_live_x"],
    ["another prefix", testSecretKey("pk_test_")],
    ["no prefix", "0123456789abcdefghij"],
  ])("refuses %s, naming the variable and not the value", (_name, key) => {
    const error = configError({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: goodSecret });
    expect(error.message).toContain("STRIPE_SECRET_KEY");
    expect(error.message).not.toContain(key);
  });

  it("refuses a webhook secret without whsec_, naming the variable and not the value", () => {
    const bad = "abcdefghij0123456789";
    const error = configError({ STRIPE_SECRET_KEY: testSecretKey(), STRIPE_WEBHOOK_SECRET: bad });
    expect(error.message).toContain("STRIPE_WEBHOOK_SECRET");
    expect(error.message).not.toContain(bad);
  });

  it.each(["sk_test_", "rk_test_", "rkcs_test_"])("accepts a %s key", (prefix) => {
    const config = parseConfig({ STRIPE_SECRET_KEY: testSecretKey(prefix), STRIPE_WEBHOOK_SECRET: goodSecret });
    expect(config.stripe).toEqual({ secretKey: testSecretKey(prefix), webhookSecret: goodSecret });
  });

  it("is unconfigured when both are absent or blank", () => {
    expect(parseConfig({}).stripe).toBeUndefined();
    expect(parseConfig({ STRIPE_SECRET_KEY: " ", STRIPE_WEBHOOK_SECRET: "" }).stripe).toBeUndefined();
  });

  it("refuses a half-configured pair, naming the missing variable", () => {
    expect(configError({ STRIPE_SECRET_KEY: testSecretKey() }).message).toContain("STRIPE_WEBHOOK_SECRET");
    expect(configError({ STRIPE_WEBHOOK_SECRET: goodSecret }).message).toContain("STRIPE_SECRET_KEY");
  });
});

describe("EV-021 check 2: StripeCheckoutPort refuses live sessions and foreign URLs", () => {
  const portFor = (overrides: Record<string, unknown>) =>
    new StripeCheckoutPort(stubClient({ create: async () => stubSession(overrides), retrieve: async () => stubSession(overrides) }));

  it("refuses livemode: true with an error and no url", async () => {
    const outcome = await portFor({ livemode: true })
      .createSession(params, options)
      .then(
        (result) => result,
        (error: unknown) => error,
      );
    expect(outcome).toBeInstanceOf(CheckoutPortError);
    expect((outcome as CheckoutPortError).code).toBe("livemode-refused");
    expect(outcome).not.toHaveProperty("url");
  });

  it.each(["https://evil.example.com/pay", "http://checkout.stripe.com/c/pay/x", "https://checkout.stripe.com.evil.example/x"])("refuses url %s", async (url) => {
    await expect(portFor({ url }).createSession(params, options)).rejects.toMatchObject({ code: "unsafe-url" });
    await expect(portFor({ url }).retrieveSession("cs_test_stub")).rejects.toMatchObject({ code: "unsafe-url" });
  });

  it("refuses livemode: true on retrieveSession", async () => {
    await expect(portFor({ livemode: true }).retrieveSession("cs_test_stub")).rejects.toMatchObject({ code: "livemode-refused" });
  });

  it("treats an open session with a null url as stripe-error", async () => {
    await expect(portFor({ url: null }).createSession(params, options)).rejects.toMatchObject({ code: "stripe-error" });
    await expect(portFor({ url: null }).retrieveSession("cs_test_stub")).rejects.toMatchObject({ code: "stripe-error" });
  });

  it("accepts a sandbox session with a checkout.stripe.com url", async () => {
    await expect(portFor({}).createSession(params, options)).resolves.toMatchObject({ id: "cs_test_stub", status: "open", livemode: false, amountTotal: 100, currency: "usd" });
  });
});

describe("EV-021 check 4: no key-shaped value in tracked files", () => {
  const PATTERN = /(sk|rk|rkcs|pk)_(test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/;
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);

  it("matches the pattern in no tracked file, binaries included", () => {
    const hits = tracked.filter((file) => {
      const path = join(ROOT, file);
      if (!existsSync(path)) {
        console.warn(`EV-021 check 4: skipping ${file}, deleted in the working copy`);
        return false;
      }
      return PATTERN.test(readFileSync(path).toString("latin1"));
    });
    expect(hits).toEqual([]);
  });

  it("ignores .env.local", () => {
    expect(() => execFileSync("git", ["check-ignore", "-q", ".env.local"], { cwd: ROOT })).not.toThrow();
  });

  it.todo("ignores .data/");
});
