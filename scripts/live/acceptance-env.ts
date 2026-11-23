import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionResult } from "../../src/commerce/port";
import { StripeCheckoutPort } from "../../src/commerce/stripe-port";
import { ApiErrorBodySchema } from "../../src/research/events";
import { parseConfig } from "../../src/server/config";
import { createApp } from "../../src/server/app";
import { createRuntime } from "../../src/server/runtime";
import { parseSse } from "../../tests/server/sse";
import { AcceptanceAbort, failedResearchRun, usageOfChunks } from "./acceptance";
import type { AcceptanceEnv, AcceptanceStep, Precondition } from "./acceptance";
import type { CaseQuery } from "./acceptance-log";
import { EVIDENCE_DIR } from "./acceptance-log";
import { acceptanceBudgetRefusal, addAcceptanceExaSpend, EXA_COUNTER_PATH, planUsage, readExaCounter, round6, usageFromEvidence } from "./exa-counter";
import type { PlanUsage } from "./exa-counter";
import { DryPort, gitSha, loadSandboxConfig, parseLogLines, REAL_SLEEP, resendWithStripeCli, waitForOwner } from "./sandbox-env";
import { redact } from "./sandbox-smoke";

const SERVER_PORT = 8787;
const WEBHOOK_PATH = "/api/stripe/webhook";
const WEBHOOK_URL = `http://127.0.0.1:${SERVER_PORT}${WEBHOOK_PATH}`;
const FROZEN_LISTEN_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "payment_intent.payment_failed",
] as const;

const gitDirty = (): boolean => execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";

const chatBody = (query: CaseQuery, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: query.text }] }], market: query.market, ...extra });

function printOwnerStep(say: (line: string) => void, step: AcceptanceStep, timeoutMs: number): void {
  say(`\n== Owner step ${step.id} (order ${step.orderId}) ==`);
  say(`Open this Stripe-hosted page in your browser:\n${step.url}`);
  say(`Do: ${step.steps}`);
  say(`Expect: ${step.expect}`);
  say(`Kensaku's demo total for this cart: ${step.demoTotal}. Check it against the hosted page's total, the line item names (start with "Simulated:"), and the description (H1, H2).`);
  say(`Use Kensaku at http://127.0.0.1:${SERVER_PORT} in your browser; the order must leave "open" through Stripe, never through this terminal.`);
  say(`Waiting for the order to leave "open" (up to ${Math.round(timeoutMs / 60_000)} minutes)...`);
}

export interface LiveAcceptanceOptions {
  serverLogPath: string;
  ownerTimeoutMs: number;
  exaCounterPath?: string;
  evidenceDir?: string;
  commerceDir?: string;
}

export interface ListenVerdict {
  ok: boolean;
  matching: string[];
  rest: { line: string; problems: string[] }[];
}

export function evaluateListenLines(lines: readonly string[]): ListenVerdict {
  const judged = lines
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const subscribed = new Set((/--events[ =]+(\S+)/.exec(line)?.[1] ?? "").split(","));
      const missing = FROZEN_LISTEN_EVENTS.filter((e) => !subscribed.has(e));
      const problems = [
        ...(line.includes(WEBHOOK_URL) ? [] : [`does not forward to ${WEBHOOK_URL}`]),
        ...(missing.length === 0 ? [] : [`does not subscribe to ${missing.join(", ")}`]),
        ...(/--live\b/.test(line) ? ["was started with --live"] : []),
      ];
      return { line, problems };
    });
  const matching = judged.filter((j) => j.problems.length === 0).map((j) => j.line);
  const rest = judged.filter((j) => j.problems.length > 0);
  return { ok: matching.length === 1, matching, rest };
}

export function serverLogListens(text: string): { ok: boolean; detail: string } {
  const listening = text.split("\n").flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as { event?: unknown; port?: unknown; mode?: unknown };
      return parsed.event === "listening" ? [parsed] : [];
    } catch {
      return [];
    }
  });
  const last = listening.at(-1);
  if (!last) return { ok: false, detail: "the file holds no `listening` line: start the server with `pnpm start 2>&1 | tee <file>` and pass that file" };
  const ok = last.port === SERVER_PORT && last.mode === "live";
  return { ok, detail: ok ? `listening on port ${SERVER_PORT} in live mode` : `its last listening line says port ${String(last.port)}, mode ${String(last.mode)}; it must be port ${SERVER_PORT}, mode live` };
}

async function listenPrecondition(webhookSecret: string, scrub: (text: string) => string): Promise<Precondition> {
  const name = "stripe listen is running against the sandbox with the secret in .env.local";
  let printed: string | undefined;
  try {
    printed = /whsec_\S+/.exec(execFileSync("stripe", ["listen", "--print-secret"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] }))?.[0];
  } catch {
    return { name, ok: false, detail: "`stripe listen --print-secret` failed: is the Stripe CLI installed and logged in to the sandbox (`stripe login`)?" };
  }
  const stdout = await new Promise<string>((done) => execFile("pgrep", ["-fl", "stripe listen"], (_error, out) => done(out)));
  const verdict = evaluateListenLines(stdout.split("\n"));
  const problems = [
    ...(printed === webhookSecret ? [] : ["STRIPE_WEBHOOK_SECRET differs from `stripe listen --print-secret`"]),
    ...(verdict.ok ? [] : [verdict.matching.length > 1 ? "more than one listener forwards to this server" : "no single `stripe listen` process forwards to the server with all five events and without --live"]),
  ];
  const shown = [
    `matching: ${verdict.matching.length === 0 ? "none" : verdict.matching.map(scrub).join(" | ")}`,
    ...verdict.rest.map((r) => `not matching (${r.problems.join("; ")}): ${scrub(r.line)}`),
  ];
  return { name, ok: problems.length === 0, detail: `${problems.length === 0 ? "secret matches; one listener forwards to 127.0.0.1:8787 with all five events" : problems.join("; ")}. ${shown.join(". ")}` };
}

export function liveAcceptanceEnv(options: LiveAcceptanceOptions, say: (line: string) => void = console.log): AcceptanceEnv {
  const config = loadSandboxConfig("EV-023");
  if (!existsSync(options.serverLogPath)) throw new AcceptanceAbort(`--server-log ${options.serverLogPath} does not exist: start the server with its output saved there (\`pnpm start 2>&1 | tee <file>\`).`);
  const base = `http://127.0.0.1:${config.port}`;
  const counterPath = options.exaCounterPath ?? EXA_COUNTER_PATH;
  const evidenceDir = options.evidenceDir ?? EVIDENCE_DIR;
  const commerceDir = resolve(options.commerceDir ?? ".data/commerce");
  const port = StripeCheckoutPort.fromSecretKey(config.stripe.secretKey);
  const secrets = [config.stripe.secretKey, config.stripe.webhookSecret];
  const scrub = (text: string) => secrets.reduce((out, s) => out.replaceAll(s, "[redacted]"), redact(text));
  const usage = (): PlanUsage => planUsage(readExaCounter(counterPath), usageFromEvidence(evidenceDir));

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
      const keyKind = /^(?:sk|rk|rkcs)_test_/.exec(config.stripe.secretKey)?.[0];
      const checks: Precondition[] = [
        { name: "STRIPE_SECRET_KEY is a sandbox key", ok: keyKind !== undefined, detail: keyKind !== undefined ? `the loaded key starts ${keyKind}` : "the loaded key does not start sk_test_, rk_test_ or rkcs_test_" },
        await listenPrecondition(config.stripe.webhookSecret, scrub),
      ];
      const listens = serverLogListens(readFileSync(options.serverLogPath, "utf8"));
      checks.push({ name: "--server-log holds this server's listening line (port 8787, live mode)", ok: listens.ok, detail: listens.detail });
      let server: Precondition = { name: "the server runs `pnpm start` in live mode at 127.0.0.1:8787 with checkout configured", ok: false, detail: "" };
      try {
        const health = (await api("GET", "/api/health")).body as { mode?: string; exaConfigured?: boolean };
        const cart = (await api("GET", "/api/cart")).body as { checkoutConfigured?: boolean; cart?: { lines: unknown[] } };
        const problems = [
          ...(config.port === SERVER_PORT ? [] : [`KENSAKU_PORT is ${config.port}; EV-023 runs at ${SERVER_PORT}`]),
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
      const refusal = acceptanceBudgetRefusal(usage());
      checks.push({ name: "the plan-wide Exa budget has room", ok: refusal === undefined, detail: refusal ?? "room for at least one research attempt" });
      return checks;
    },
    planUsage: usage,
    exaRefusal: () => acceptanceBudgetRefusal(usage()),
    recordExaSpend: (spend) => void addAcceptanceExaSpend(counterPath, spend),
    research: async (query) => {
      try {
        const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: chatBody(query), signal: AbortSignal.timeout(150_000) });
        const text = await res.text();
        const chunks = parseSse(text);
        if (res.status === 200) return { chunks, ...usageOfChunks(chunks) };
        const apiError = ApiErrorBodySchema.safeParse(safeJson(text));
        return {
          ...failedResearchRun(`POST /api/chat answered ${res.status}; no Exa request is retried by this script`, chunks, res.status),
          ...(apiError.success && { errorKind: apiError.data.kind }),
        };
      } catch (error) {
        return failedResearchRun(`POST /api/chat failed: ${error instanceof Error ? error.message : String(error)}`);
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

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

async function allEmptyOnServer(api: AcceptanceEnv["api"]): Promise<boolean> {
  const cart = (await api("GET", "/api/cart")).body as { cart: { lines: unknown[] } };
  const orders = (await api("GET", "/api/orders")).body as { orders: unknown[] };
  return cart.cart.lines.length === 0 && orders.orders.length === 0;
}

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

export function dryAcceptanceEnv(say: (line: string) => void = () => {}, scenarios: Record<string, string> = DRY_SCENARIO, evidenceDir = EVIDENCE_DIR): AcceptanceEnv {
  const config = parseConfig({ NODE_ENV: "test", KENSAKU_EXA_MODE: "fixture", STRIPE_SECRET_KEY: `sk_test_${"0".repeat(20)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"0".repeat(20)}` });
  const logged: string[] = [];
  const port = new CompletingPort(config.port);
  const app = createApp(createRuntime(config, { fakeCheckoutPort: port, log: (line) => logged.push(line) }));
  const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method, headers: { host: `127.0.0.1:${config.port}`, "content-type": "application/json", ...headers }, ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }) });
  const sessionOf = async (orderId: string) => ((await (await request("GET", `/api/orders/${orderId}`)).json()) as { order: { stripeSessionId: string } }).order.stripeSessionId;
  const usage: PlanUsage = usageFromEvidence(evidenceDir);

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
    planUsage: () => usage,
    exaRefusal: () => acceptanceBudgetRefusal(usage),
    recordExaSpend: (spend) => {
      usage.planRequests += spend.requests;
      usage.ev023Requests += spend.requests;
      usage.planCostDollars = round6(usage.planCostDollars + spend.costDollars);
    },
    research: async (query) => {
      const res = await request("POST", "/api/chat", JSON.parse(chatBody(query, { fixtureScenario: scenarios[query.id] })));
      const chunks = parseSse(await res.text());
      return { chunks, ...usageOfChunks(chunks) };
    },
    ownerStep: async (step, done) => {
      say(`  (dry run) owner action "${step.action}" for ${step.id}`);
      const sessionId = await sessionOf(step.orderId);
      await done();
      if (step.action === "pay") {
        await request("POST", `/__test/checkout/${sessionId}/pay`);
        port.markComplete(sessionId);
      } else {
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
