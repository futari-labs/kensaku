import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CheckoutPortError } from "../../src/commerce/port";
import { StripeCheckoutPort, signTestPayload, stripeEventEnvelope } from "../../src/commerce/stripe-port";
import { createApp } from "../../src/server/app";
import { ConfigError, parseConfig } from "../../src/server/config";
import { createRuntime } from "../../src/server/runtime";
import { Q1 } from "../fixtures/questions";
import { ofType, parseSse } from "../server/sse";
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

  it("ignores .data/", () => {
    expect(() => execFileSync("git", ["check-ignore", "-q", ".data/commerce/state.json"], { cwd: ROOT })).not.toThrow();
  });
});

const KEY_PATTERN = /(sk|rk|rkcs|pk)_(test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/;

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function ensureFreshBuild(): void {
  const newest = (dir: string): number => filesUnder(dir).reduce((latest, f) => Math.max(latest, statSync(f).mtimeMs), 0);
  const built = join(ROOT, "dist/index.html");
  if (!existsSync(built) || statSync(built).mtimeMs < newest(join(ROOT, "src"))) {
    execFileSync("pnpm", ["build"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, NODE_ENV: "production" } });
  }
}

describe("EV-021 check 3: a fixture purchase leaves no key or secret anywhere", () => {
  const KEY = `sk_test_${randomBytes(16).toString("hex")}`;
  const SECRET = `whsec_${randomBytes(16).toString("hex")}`;
  const tmp = mkdtempSync(join(tmpdir(), "kensaku-ev021-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("keeps both strings, and anything shaped like either, out of logs, responses, .data/commerce/, .cache/offers/, and dist/", async () => {
    ensureFreshBuild();
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
    const seen: string[] = [];
    try {
      const config = parseConfig({ NODE_ENV: "test", KENSAKU_EXA_MODE: "fixture", KENSAKU_PORT: "8787", STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET });
      const dirs = { cacheDir: join(tmp, "cache"), commerceDir: join(tmp, "data", "commerce") };
      const app = createApp(createRuntime(config, dirs));
      const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
        const raw = typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body);
        const res = await app.request(path, { method, headers: { host: "127.0.0.1:8787", "content-type": "application/json", ...headers }, ...(raw !== undefined && { body: raw }) });
        const text = await res.text();
        seen.push(`${method} ${path} ${res.status}\n${[...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${text}`);
        return { status: res.status, text };
      };
      const send = async (id: string, type: string, object: Record<string, unknown>) => {
        const payload = JSON.stringify(stripeEventEnvelope(id, type, object));
        return call("POST", "/api/stripe/webhook", payload, { "stripe-signature": signTestPayload(payload, SECRET, Math.floor(Date.now() / 1000)) });
      };

      const chat = await call("POST", "/api/chat", { messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: Q1 }] }], market: "US", fixtureScenario: "xm5-us" }, { origin: "http://127.0.0.1:8787" });
      const offer = ofType(parseSse(chat.text), "data-products")[0]?.data.flatMap((p) => p.offerGroups.flatMap((g) => g.offers)).find((o) => o.id && o.availability !== "out_of_stock");
      expect(offer?.id).toBeDefined();
      expect((await call("POST", "/api/cart/items", { offerId: offer!.id })).status).toBe(200);

      const first = JSON.parse((await call("POST", "/api/checkout", {})).text) as { orderId: string };
      const { stripeSessionId, totalMinor, currency } = (JSON.parse((await call("GET", `/api/orders/${first.orderId}`)).text) as { order: { stripeSessionId: string; totalMinor: number; currency: string } }).order;
      const completed = await send("evt_ev021_paid", "checkout.session.completed", { id: stripeSessionId, object: "checkout.session", client_reference_id: first.orderId, status: "complete", payment_status: "paid", amount_total: totalMinor, currency: currency.toLowerCase(), livemode: false });
      expect(JSON.parse(completed.text)).toEqual({ outcome: "applied" });
      await call("POST", "/api/stripe/webhook", "{}", { "stripe-signature": "t=1,v1=00" });
      await call("POST", "/api/cart/items", { offerId: offer!.id });
      const second = JSON.parse((await call("POST", "/api/checkout", {})).text) as { orderId: string };
      expect((await call("POST", `/api/orders/${second.orderId}/cancel`, {})).status).toBe(200);
      await call("GET", "/api/orders");
      await call("GET", "/api/cart");
    } finally {
      spy.mockRestore();
    }

    const files = [...filesUnder(join(tmp, "data", "commerce")), ...filesUnder(join(tmp, "cache", "offers")), ...filesUnder(join(ROOT, "dist"))];
    expect(files.some((f) => f.includes("state.json"))).toBe(true);
    expect(files.some((f) => f.includes(`${join("cache", "offers")}`))).toBe(true);
    expect(files.some((f) => f.includes("dist"))).toBe(true);
    const haystacks = [...logged, ...seen, ...files.map((f) => readFileSync(f).toString("latin1"))];
    expect(logged.length).toBeGreaterThan(0);
    for (const text of haystacks) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(SECRET);
      expect(text).not.toMatch(KEY_PATTERN);
    }
  }, 300_000);
});

describe("EV-021 check 5: the cart route reports checkoutConfigured, and /api/health says nothing about Stripe", () => {
  const dirs = () => {
    const root = mkdtempSync(join(tmpdir(), "kensaku-ev021-cfg-"));
    return { cacheDir: join(root, "cache"), commerceDir: join(root, "data") };
  };
  const get = async (env: Record<string, string>, path: string) => {
    const app = createApp(createRuntime(parseConfig(env), dirs()));
    const res = await app.request(path, { headers: { host: "127.0.0.1:8787" } });
    return res.json() as Promise<Record<string, unknown>>;
  };

  it("is true with both values, false without", async () => {
    expect((await get({ STRIPE_SECRET_KEY: testSecretKey(), STRIPE_WEBHOOK_SECRET: testWebhookSecret() }, "/api/cart")).checkoutConfigured).toBe(true);
    expect((await get({}, "/api/cart")).checkoutConfigured).toBe(false);
    expect((await get({ NODE_ENV: "test", KENSAKU_EXA_MODE: "fixture" }, "/api/cart")).checkoutConfigured).toBe(true);
  });

  it("keeps the v1.1 health shape, with or without Stripe configured", async () => {
    const stripe = { STRIPE_SECRET_KEY: testSecretKey(), STRIPE_WEBHOOK_SECRET: testWebhookSecret() };
    expect(await get(stripe, "/api/health")).toEqual({ ok: true, exaConfigured: false, mode: "live" });
    expect(await get({}, "/api/health")).toEqual({ ok: true, exaConfigured: false, mode: "live" });
  });
});
