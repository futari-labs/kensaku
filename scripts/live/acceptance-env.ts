// The two environments of the EV-023 flow: the live one (real server, Stripe sandbox, owner) and the dry one (fake port,
// fixture research, in-process app). The live env only verifies preconditions; the coordinator starts `stripe listen` and
// `pnpm start` itself.
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionResult } from "../../src/commerce/port";
import { StripeCheckoutPort } from "../../src/commerce/stripe-port";
import { parseConfig } from "../../src/server/config";
import { createApp } from "../../src/server/app";
import { createRuntime } from "../../src/server/runtime";
import { parseSse } from "../../tests/server/sse";
import { ofType } from "../../tests/server/sse";
import { AcceptanceAbort } from "./acceptance";
import type { AcceptanceEnv, AcceptanceStep, Precondition, ResearchRun } from "./acceptance";
import type { CaseQuery } from "./acceptance-log";
import { acceptanceBudgetRefusal, addAcceptanceExaRequests, EXA_COUNTER_PATH, readExaCounter, RUN_EXA_MAX } from "./exa-counter";
import type { ExaCounter } from "./exa-counter";
import { DryPort, gitSha, loadSandboxConfig, parseLogLines, REAL_SLEEP, resendWithStripeCli, waitForOwner } from "./sandbox-env";
import { redact } from "./sandbox-smoke";

const REQUIRED_LISTEN_EVENT = "checkout.session.completed";
const WEBHOOK_PATH = "/api/stripe/webhook";
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const gitDirty = (): boolean => execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";

const usageOf = (chunks: ReturnType<typeof parseSse>, fallback: number): Omit<ResearchRun, "chunks"> => {
  const usage = ofType(chunks, "data-usage")[0]?.data;
  return { requests: usage?.exaRequests ?? fallback, costDollars: usage?.costDollars ?? 0, cacheHits: usage?.cacheHits ?? 0 };
};

const chatBody = (query: CaseQuery, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: query.text }] }], market: query.market, ...extra });

function printOwnerStep(say: (line: string) => void, step: AcceptanceStep, timeoutMs: number): void {
  say(`\n== Owner step ${step.id} (order ${step.orderId}) ==`);
  say(`Open this Stripe-hosted page in your browser:\n${step.url}`);
  say(`Do: ${step.steps}`);
  say(`Expect: ${step.expect}`);
  say(`Kensaku's demo total for this cart: ${step.demoTotal}. Check it against the hosted page's total, the line item names (start with "Simulated:"), and the description (H1, H2).`);
  say(`Use Kensaku at http://127.0.0.1:8787 in your browser; the order must leave "open" through Stripe, never through this terminal.`);
  say(`Waiting for the order to leave "open" (up to ${Math.round(timeoutMs / 60_000)} minutes)...`);
}

export interface LiveAcceptanceOptions {
  serverLogPath: string;
  ownerTimeoutMs: number;
  /** Where the plan-wide Exa request counter lives; tests point it elsewhere. */
  exaCounterPath?: string;
  /** The folder the server keeps its commerce state in, relative to the working directory. */
  commerceDir?: string;
}

async function listenPrecondition(secret: string): Promise<Precondition[]> {
  const name = "stripe listen is running against the sandbox with the secret in .env.local";
  let printed: string | undefined;
  try {
    printed = /whsec_\S+/.exec(execFileSync("stripe", ["listen", "--print-secret"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] }))?.[0];
  } catch {
    return [{ name, ok: false, detail: "`stripe listen --print-secret` failed: is the Stripe CLI installed and logged in to the sandbox (`stripe login`)?" }];
  }
  const secretOk = printed !== undefined && sha256(printed) === sha256(secret);
  const command = await new Promise<string>((done) => execFile("pgrep", ["-fl", "stripe listen"], (_error, stdout) => done(stdout)));
  const running = command.trim() !== "";
  const forwards = command.includes(`127.0.0.1:8787${WEBHOOK_PATH}`);
  const live = /--live\b/.test(command);
  const missingEvents = ["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "payment_intent.payment_failed"].filter((e) => !command.includes(e));
  const problems = [
    ...(secretOk ? [] : ["STRIPE_WEBHOOK_SECRET differs from `stripe listen --print-secret` (compared by hash)"]),
    ...(running ? [] : ["no `stripe listen` process is running"]),
    ...(running && !forwards ? [`it does not forward to http://127.0.0.1:8787${WEBHOOK_PATH}`] : []),
    ...(live ? ["it was started with --live"] : []),
    ...(running && missingEvents.includes(REQUIRED_LISTEN_EVENT) ? [`it does not listen for ${REQUIRED_LISTEN_EVENT}`] : []),
  ];
  const detail = problems.length === 0 ? `secret hashes match; listener forwards to 127.0.0.1:8787${missingEvents.length > 0 ? ` (not subscribed to: ${missingEvents.join(", ")})` : " with all five events"}` : problems.join("; ");
  return [{ name, ok: problems.length === 0, detail }];
}

export function liveAcceptanceEnv(options: LiveAcceptanceOptions, say: (line: string) => void = console.log): AcceptanceEnv {
  const config = loadSandboxConfig("EV-023");
  if (!existsSync(options.serverLogPath)) throw new AcceptanceAbort(`--server-log ${options.serverLogPath} does not exist: start the server with its output saved there (\`pnpm start 2>&1 | tee <file>\`).`);
  const base = `http://127.0.0.1:${config.port}`;
  const counterPath = options.exaCounterPath ?? EXA_COUNTER_PATH;
  const commerceDir = resolve(options.commerceDir ?? ".data/commerce");
  const port = StripeCheckoutPort.fromSecretKey(config.stripe.secretKey);
  const secrets = [config.stripe.secretKey, config.stripe.webhookSecret];
  const scrub = (text: string) => secrets.reduce((out, s) => out.replaceAll(s, "[redacted]"), redact(text));

  const api: AcceptanceEnv["api"] = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(150_000) });
    return { status: res.status, body: JSON.parse(await res.text()) as unknown };
  };

  return {
    mode: "live",
    port,
    api,
    sandboxSessionId: /^cs_test_/,
    webhook: async (rawBody, signature) => {
      const res = await fetch(`${base}${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...(signature !== undefined && { "stripe-signature": signature }) }, body: rawBody, signal: AbortSignal.timeout(30_000) });
      await res.text();
      return res.status;
    },
    preconditions: async () => {
      const checks: Precondition[] = [
        { name: "STRIPE_SECRET_KEY is a sandbox key", ok: true, detail: "accepted by the server's own configuration check (sk_test_, rk_test_ or rkcs_test_)" },
        ...(await listenPrecondition(config.stripe.webhookSecret)),
      ];
      let server: Precondition = { name: "the server runs `pnpm start` in live mode at 127.0.0.1:8787 with checkout configured", ok: false, detail: "" };
      try {
        const health = (await api("GET", "/api/health")).body as { mode?: string; exaConfigured?: boolean };
        const cart = (await api("GET", "/api/cart")).body as { checkoutConfigured?: boolean; cart?: { lines: unknown[] } };
        const problems = [
          ...(health.mode === "live" ? [] : [`the server reports mode ${String(health.mode)}, not live`]),
          ...(health.exaConfigured === true ? [] : ["the server has no EXA_API_KEY"]),
          ...(cart.checkoutConfigured === true ? [] : ["the server reports checkout is not configured"]),
        ];
        server = { ...server, ok: problems.length === 0, detail: problems.length === 0 ? "live mode, Exa key set, checkout configured" : problems.join("; ") };
      } catch {
        server = { ...server, detail: `nothing answered at ${base}: start it with pnpm start (saving its output to the --server-log file)` };
      }
      checks.push(server);
      const entries = existsSync(commerceDir) ? readdirSync(commerceDir) : [];
      const apiEmpty = await allEmptyOnServer(api).catch(() => false);
      checks.push({
        name: ".data/commerce/ is empty at the start of the run",
        ok: entries.length === 0 && apiEmpty,
        detail: entries.length === 0 && apiEmpty ? "no state file; the server's cart and orders are empty" : "found earlier state: stop the server, run `rm -rf .data/commerce`, start the server again, and re-run",
      });
      const refusal = acceptanceBudgetRefusal(readExaCounter(counterPath));
      checks.push({ name: "the plan-wide Exa counter has room", ok: refusal === undefined, detail: refusal ?? "room for at least one research run" });
      return checks;
    },
    exaRefusal: () => acceptanceBudgetRefusal(readExaCounter(counterPath)),
    exaCounter: () => readExaCounter(counterPath),
    research: async (query) => {
      let spent = RUN_EXA_MAX;
      try {
        const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: chatBody(query), signal: AbortSignal.timeout(150_000) });
        if (res.status !== 200) {
          spent = 0;
          throw new Error(`POST /api/chat answered ${res.status}; no Exa request is retried by this script`);
        }
        const chunks = parseSse(await res.text());
        const run = { chunks, ...usageOf(chunks, RUN_EXA_MAX) };
        spent = run.requests;
        return run;
      } finally {
        if (spent > 0) addAcceptanceExaRequests(counterPath, spent);
      }
    },
    ownerStep: async (step, done) => {
      printOwnerStep(say, step, options.ownerTimeoutMs);
      return waitForOwner(done, options.ownerTimeoutMs);
    },
    resend: (eventId) => resendWithStripeCli(eventId, scrub),
    webhookLog: async () => parseLogLines(readFileSync(options.serverLogPath, "utf8")),
    now: () => new Date(),
    sleep: REAL_SLEEP,
    gitSha,
    gitDirty,
    say,
  };
}

async function allEmptyOnServer(api: AcceptanceEnv["api"]): Promise<boolean> {
  const cart = (await api("GET", "/api/cart")).body as { cart: { lines: unknown[] } };
  const orders = (await api("GET", "/api/orders")).body as { orders: unknown[] };
  return cart.cart.lines.length === 0 && orders.orders.length === 0;
}

/** The dry port, which also reads a session as complete once the fake hosted page took its payment. */
class CompletingPort extends DryPort {
  private readonly completed = new Set<string>();

  markComplete(id: string): void {
    this.completed.add(id);
  }

  override async retrieveSession(id: string): Promise<SessionResult> {
    const session = await super.retrieveSession(id);
    return this.completed.has(id) && session.status === "open" ? { ...session, status: "complete", url: null } : session;
  }
}

const DRY_SCENARIO: Record<string, string> = { Q1: "xm5-us", Q3: "xm5-sg", Q5: "xm5-jp" };

export function dryAcceptanceEnv(say: (line: string) => void = () => {}, scenarios: Record<string, string> = DRY_SCENARIO): AcceptanceEnv {
  const config = parseConfig({ NODE_ENV: "test", KENSAKU_EXA_MODE: "fixture", STRIPE_SECRET_KEY: `sk_test_${"0".repeat(20)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"0".repeat(20)}` });
  const logged: string[] = [];
  const port = new CompletingPort(config.port);
  const app = createApp(createRuntime(config, { fakeCheckoutPort: port, log: (line) => logged.push(line) }));
  const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method, headers: { host: `127.0.0.1:${config.port}`, "content-type": "application/json", ...headers }, ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }) });
  const sessionOf = async (orderId: string) => ((await (await request("GET", `/api/orders/${orderId}`)).json()) as { order: { stripeSessionId: string } }).order.stripeSessionId;
  const counter: ExaCounter = { planRequests: 3, smokeRequests: 3 };

  return {
    mode: "dry-run",
    port,
    sandboxSessionId: /^cs_(?:test|fake)_/,
    api: async (method, path, body) => {
      const res = await request(method, path, body);
      return { status: res.status, body: await res.json() };
    },
    webhook: async (rawBody, signature) => (await request("POST", WEBHOOK_PATH, rawBody, signature !== undefined ? { "stripe-signature": signature } : {})).status,
    preconditions: async () => [{ name: "dry run", ok: true, detail: "fixture research, fake checkout port, in-process app; nothing leaves this process" }],
    exaRefusal: () => acceptanceBudgetRefusal(counter),
    exaCounter: () => counter,
    research: async (query) => {
      const res = await request("POST", "/api/chat", JSON.parse(chatBody(query, { fixtureScenario: scenarios[query.id] })));
      const chunks = parseSse(await res.text());
      const run = { chunks, ...usageOf(chunks, 0) };
      counter.planRequests += run.requests;
      counter.ev023Requests = (counter.ev023Requests ?? 0) + run.requests;
      return run;
    },
    ownerStep: async (step, done) => {
      say(`  (dry run) owner action "${step.action}" for ${step.id}`);
      const sessionId = await sessionOf(step.orderId);
      await done();
      if (step.action === "pay") {
        await request("POST", `/__test/checkout/${sessionId}/pay`);
        port.markComplete(sessionId);
      }
      else {
        if (step.action === "decline") await request("POST", `/__test/checkout/${sessionId}/decline`);
        await request("POST", `/api/orders/${step.orderId}/cancel`, {});
      }
      return done();
    },
    resend: async (eventId) => {
      const sessionId = eventId.replace("evt_fake_completed_", "");
      await request("POST", `/__test/checkout/${sessionId}/pay`);
      return { exitCode: 0, output: "dry-run: the same event was delivered again in process" };
    },
    webhookLog: async () => parseLogLines(logged.join("\n")),
    now: () => new Date(),
    sleep: async () => {},
    gitSha,
    gitDirty,
    say,
  };
}
