import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeCheckoutPort } from "../../src/commerce/fake-port";
import { CheckoutPortError } from "../../src/commerce/port";
import type { SessionResult } from "../../src/commerce/port";
import { OfferStore } from "../../src/commerce/registry";
import { StripeCheckoutPort } from "../../src/commerce/stripe-port";
import type { StripeErrorShape } from "../../src/commerce/stripe-port";
import { toRegisteredOffer } from "../../src/core/commerce";
import type { RegisteredOffer } from "../../src/core/commerce";
import { createApp } from "../../src/server/app";
import { loadKeyFile, parseConfig } from "../../src/server/config";
import type { ServerConfig } from "../../src/server/config";
import { createRuntime } from "../../src/server/runtime";
import { Q1 } from "../../tests/fixtures/questions";
import { ofType, parseSse } from "../../tests/server/sse";
import { addSmokeExaRequests, EXA_COUNTER_PATH, exaBudgetRefusal, readExaCounter, RUN_EXA_MAX } from "./exa-counter";
import { redact, SmokeAbort } from "./sandbox-smoke";
import type { OwnerStep, SmokeEnv, WebhookLogLine } from "./sandbox-smoke";

const OWNER_POLL_MS = 2_000;
export const REAL_SLEEP = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

export const gitSha = (): string => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function offersOfStream(body: string, market: RegisteredOffer["market"], at: string): { offers: RegisteredOffer[]; exaRequests: number } {
  const chunks = parseSse(body);
  const offers = (ofType(chunks, "data-products")[0]?.data ?? []).flatMap((p) => p.offerGroups.flatMap((g) => g.offers));
  return {
    exaRequests: ofType(chunks, "data-usage")[0]?.data.exaRequests ?? 0,
    offers: offers.flatMap((o) => toRegisteredOffer(o, market, at) ?? []),
  };
}

export function parseLogLines(text: string): WebhookLogLine[] {
  return text.split("\n").flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.event !== "webhook") return [];
      const field = (name: keyof WebhookLogLine) => (typeof parsed[name] === "string" ? { [name]: parsed[name] } : {});
      return [{ ...field("eventId"), ...field("type"), ...field("outcome"), ...field("orderId"), ...field("from"), ...field("to") }];
    } catch {
      return [];
    }
  });
}

export function resendWithStripeCli(eventId: string, scrub: (text: string) => string): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolveResend) => {
    execFile("stripe", ["events", "resend", eventId], { timeout: 60_000 }, (error, stdout, stderr) => {
      const exitCode = error ? ((error as { code?: unknown }).code as number | null) ?? null : 0;
      resolveResend({ exitCode: typeof exitCode === "number" ? exitCode : null, output: scrub(`${stdout}\n${stderr}`) });
    });
  });
}

export async function waitForOwner(done: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await done()) return true;
    await REAL_SLEEP(OWNER_POLL_MS);
  }
  return false;
}

export interface LiveOptions {
  offerIds: string[];
  serverLogPath: string;
  ownerTimeoutMs: number;
  /** Where the plan-wide Exa request counter lives; tests point it elsewhere. */
  exaCounterPath?: string;
}

export function loadSandboxConfig(who: string): ServerConfig & { stripe: NonNullable<ServerConfig["stripe"]> } {
  loadKeyFile();
  let config: ServerConfig;
  try {
    config = parseConfig(process.env);
  } catch (error) {
    throw new SmokeAbort(error instanceof Error ? error.message : "invalid configuration");
  }
  if (!config.stripe) throw new SmokeAbort("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must both be set (and STRIPE_SECRET_KEY must be a sandbox key).");
  if (config.mode !== "live") throw new SmokeAbort(`${who} runs in live Exa mode (unset KENSAKU_EXA_MODE).`);
  return { ...config, stripe: config.stripe };
}

export function liveEnv(options: LiveOptions): SmokeEnv {
  const config = loadSandboxConfig("the live smoke");
  if (!existsSync(options.serverLogPath)) throw new SmokeAbort(`--server-log ${options.serverLogPath} does not exist: start the server with its output saved there.`);

  const base = `http://127.0.0.1:${config.port}`;
  const counterPath = options.exaCounterPath ?? EXA_COUNTER_PATH;
  let rawError: StripeErrorShape | undefined;
  const port = StripeCheckoutPort.fromSecretKey(config.stripe.secretKey, (raw) => (rawError = raw));
  const registry = new OfferStore({ dir: resolve(".cache/offers"), clock: () => new Date() });
  const secrets = [config.stripe.secretKey, config.stripe.webhookSecret];
  const scrub = (text: string) => secrets.reduce((out, s) => out.replaceAll(s, "[redacted]"), redact(text));

  return {
    mode: "live",
    port,
    lastRawError: () => rawError,
    api: async (method, path, body) => {
      const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(150_000) });
      const text = await res.text();
      return { status: res.status, body: JSON.parse(text) as unknown };
    },
    offers: async () => {
      if (options.offerIds.length > 0) {
        const offers = options.offerIds.flatMap((id) => registry.get(id) ?? []);
        if (offers.length !== options.offerIds.length) throw new SmokeAbort("an --offer-id is not registered in .cache/offers/ (or is older than 30 days).");
        return { offers, exaRequests: 0, source: "registered" as const };
      }
      const refusal = exaBudgetRefusal(readExaCounter(counterPath));
      if (refusal) throw new SmokeAbort(`no research run started: ${refusal}`);
      let spent = RUN_EXA_MAX;
      try {
        const res = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: Q1 }] }], market: "US" }),
          signal: AbortSignal.timeout(150_000),
        });
        if (res.status !== 200) {
          spent = 0;
          throw new SmokeAbort(`POST /api/chat answered ${res.status}; no Exa request is retried by this script.`);
        }
        const found = offersOfStream(await res.text(), "US", new Date().toISOString());
        spent = found.exaRequests;
        return { ...found, source: "research" as const };
      } finally {
        if (spent > 0) addSmokeExaRequests(counterPath, spent);
      }
    },
    ownerStep: async (step: OwnerStep, done) => {
      console.log(`\n== Owner step: ${step.id} (order ${step.orderId}) ==`);
      console.log(`Open this Stripe-hosted page in your browser:\n${step.url}`);
      for (const line of step.instructions) console.log(`- ${line}`);
      console.log(`Waiting for the order to leave "open" (up to ${Math.round(options.ownerTimeoutMs / 60_000)} minutes)...`);
      return waitForOwner(done, options.ownerTimeoutMs);
    },
    resend: (eventId) => resendWithStripeCli(eventId, scrub),
    webhookLog: async () => parseLogLines(readFileSync(options.serverLogPath, "utf8")),
    now: () => new Date(),
    sleep: REAL_SLEEP,
    gitSha,
  };
}

/** A fake port that behaves like Stripe about expiry: an expired session reads as expired and cannot be expired again. */
export class DryPort extends FakeCheckoutPort {
  private readonly expired = new Set<string>();

  override async expireSession(id: string): Promise<void> {
    if (this.expired.has(id)) throw new CheckoutPortError("stripe-error");
    await super.expireSession(id);
    this.expired.add(id);
  }

  override async retrieveSession(id: string): Promise<SessionResult> {
    const session = await super.retrieveSession(id);
    return this.expired.has(id) ? { ...session, status: "expired", url: null } : session;
  }
}

export function dryEnv(): SmokeEnv {
  const config = parseConfig({ NODE_ENV: "test", KENSAKU_EXA_MODE: "fixture", STRIPE_SECRET_KEY: `sk_test_${"0".repeat(20)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"0".repeat(20)}` });
  const logged: string[] = [];
  const port = new DryPort(config.port);
  const app = createApp(createRuntime(config, { fakeCheckoutPort: port, log: (line) => logged.push(line) }));
  const request = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { host: `127.0.0.1:${config.port}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const sessionOf = async (orderId: string) => ((await (await request("GET", `/api/orders/${orderId}`)).json()) as { order: { stripeSessionId: string } }).order.stripeSessionId;
  let paidSessionId: string | undefined;

  return {
    mode: "dry-run",
    port,
    lastRawError: () => undefined,
    api: async (method, path, body) => {
      const res = await request(method, path, body);
      return { status: res.status, body: await res.json() };
    },
    offers: async () => {
      const res = await request("POST", "/api/chat", { messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: Q1 }] }], market: "US", fixtureScenario: "xm5-us" });
      return { ...offersOfStream(await res.text(), "US", new Date().toISOString()), source: "research" as const };
    },
    ownerStep: async (step, done) => {
      const sessionId = await sessionOf(step.orderId);
      await done();
      if (step.id === "purchase") {
        paidSessionId = sessionId;
        await request("POST", `/__test/checkout/${sessionId}/pay`);
      } else {
        await request("POST", `/__test/checkout/${sessionId}/decline`);
        await request("POST", `/api/orders/${step.orderId}/cancel`, {});
      }
      return done();
    },
    resend: async () => {
      await request("POST", `/__test/checkout/${paidSessionId}/pay`);
      return { exitCode: 0, output: "dry-run: the same event was delivered again in process" };
    },
    webhookLog: async () => parseLogLines(logged.join("\n")),
    now: () => new Date(),
    sleep: async () => {},
    gitSha,
  };
}
