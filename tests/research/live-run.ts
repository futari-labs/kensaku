// The live runner as a module: the JM-004 smoke (live-smoke.ts), the JM-104 slice smoke and the EV-016 suite
// (scripts/live-acceptance-v1-1.ts) use it. It runs the real server against live Exa; `executeQuery` posts a
// query to POST /api/chat, the EV-016 suite drives the page instead. Importing this file starts nothing.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Market } from "../../src/core/types";
import { ofType, parseSse } from "../server/sse";
import type { ServerProcess } from "../server/process";

export const ROOT = join(import.meta.dirname, "../..");
export const OUT_DIR = join(ROOT, ".futari/evidence/live");
const SMOKE_EXCHANGES = join(ROOT, ".cache/smoke/exchanges.jsonl");
export const PORT = 8787;
/** The server's monthly request limit during a smoke run, so every attempt together stays under it. */
export const MAX_REQUESTS = 10;

export interface LiveQuery {
  id: string;
  market: Market;
  text: string;
}

/** `file` is a live-acceptance case file under evals/cases/; the MVP set by default. */
export function loadQueries(ids: string[], file = "live-acceptance.json"): LiveQuery[] {
  const queries = (JSON.parse(readFileSync(join(ROOT, "evals/cases", file), "utf8")) as { queries: LiveQuery[] }).queries;
  return ids.map((id) => {
    const query = queries.find((q) => q.id === id);
    if (!query) throw new Error(`unknown query ${id}`);
    return query;
  });
}

export interface SmokeSession {
  server: ServerProcess;
  /** The key's first 8 characters, kept only to check that no output holds them. */
  keyPrefix: string;
  answerMarketMode: string;
  /** The exchange log this session's server appends to. */
  exchangesPath: string;
}

export interface SessionOptions {
  /** The server's request limit for the session (its ledger refuses more). */
  maxRequests?: number;
  /** The server's reported-cost limit for the session, in dollars. */
  maxCostDollars?: number;
  /** Run the server in a new empty directory, so its cache and ledger start empty. */
  fresh?: boolean;
}

/** Starts `src/server/main.ts` in `cwd` (its cache and ledger live in `<cwd>/.cache`) and resolves once it logs `listening`. */
async function spawnServerIn(cwd: string, env: NodeJS.ProcessEnv, startupMs = 20_000): Promise<ServerProcess> {
  const child = spawn(join(ROOT, "node_modules/.bin/tsx"), [join(ROOT, "src/server/main.ts")], { cwd, env });
  let output = "";
  let partial = "";
  const lines: Record<string, unknown>[] = [];
  child.stdout!.on("data", (d: Buffer) => {
    output += d.toString();
    const complete = (partial + d.toString()).split("\n");
    partial = complete.pop() ?? "";
    for (const line of complete) {
      try {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        lines.push({ raw: line.slice(0, 300) });
      }
    }
  });
  child.stderr!.on("data", (d: Buffer) => (output += d.toString()));
  const server: ServerProcess = { child, output: () => output, lines, stop: () => void child.kill() };
  const started = Date.now();
  while (!lines.some((l) => l.event === "listening")) {
    if (Date.now() - started > startupMs) {
      server.stop();
      throw new Error(`server did not start:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return server;
}

/**
 * Loads the key file into this process, then starts the server without the key in its environment
 * (it reads the file itself), with a request limit and the exchange log on. `fresh` gives the server
 * its own empty directory (the built `dist/` is linked in), so no cached Exa response can be served.
 */
export async function startSmokeServer(envFile: string, options: SessionOptions = {}): Promise<SmokeSession> {
  const { maxRequests = MAX_REQUESTS, maxCostDollars, fresh = false } = options;
  process.loadEnvFile(envFile);
  const keyPrefix = (process.env.EXA_API_KEY ?? "").slice(0, 8);
  if (keyPrefix.length < 8) throw new Error("EXA_API_KEY is missing from the env file");
  const answerMarketMode = process.env.KENSAKU_ANSWER_MARKET_MODE ?? "userLocation";
  let cwd = ROOT;
  let exchangesPath = SMOKE_EXCHANGES;
  if (fresh) {
    cwd = mkdtempSync(join(tmpdir(), "kensaku-live-"));
    symlinkSync(join(ROOT, "dist"), join(cwd, "dist"));
    exchangesPath = join(cwd, "exchanges.jsonl");
  }
  const env = { ...process.env };
  delete env.EXA_API_KEY;
  const server = await spawnServerIn(cwd, {
    ...env,
    EXA_ENV_FILE: envFile,
    NODE_ENV: "production",
    KENSAKU_EXA_MODE: "live",
    KENSAKU_PORT: String(PORT),
    KENSAKU_EXCHANGE_LOG: exchangesPath,
    KENSAKU_MONTHLY_REQUEST_LIMIT: String(maxRequests),
    ...(maxCostDollars !== undefined && { KENSAKU_MONTHLY_COST_LIMIT: String(maxCostDollars) }),
    KENSAKU_ANSWER_MARKET_MODE: answerMarketMode,
  });
  return { server, keyPrefix, answerMarketMode, exchangesPath };
}

/** One line of the server's exchange log: the request body and response of one Exa call (no key, no header). */
export interface Exchange {
  ts: string;
  endpoint: string;
  request: unknown;
  response: unknown;
}

export const readExchanges = (path: string): Exchange[] =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Exchange) : [];

/** An exchange with the Exa request id and the reported cost lifted out of the response. */
export const withBilling = (e: Exchange) => {
  const response = e.response as { requestId?: string; costDollars?: { total?: number } };
  return { ...e, requestId: response.requestId ?? null, costDollars: response.costDollars?.total ?? null };
};

/** Runs one query through the server (POST /api/chat) and returns what it did. Writes nothing. */
export async function executeQuery({ server, keyPrefix, answerMarketMode, exchangesPath }: SmokeSession, query: LiveQuery) {
  const logStart = server.lines.length;
  const exchangesBefore = readExchanges(exchangesPath).length;
  const started = new Date().toISOString();
  const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${PORT}` },
    body: JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: query.text }] }], market: query.market }),
    signal: AbortSignal.timeout(150_000),
  });
  const body = await res.text();
  const chunks = res.headers.get("content-type")?.includes("event-stream") ? parseSse(body) : [];
  const error = ofType(chunks, "data-error")[0]?.data;
  const usage = ofType(chunks, "data-usage")[0]?.data;
  const text = ofType(chunks, "text-delta")[0]?.delta;
  const exchanges = readExchanges(exchangesPath).slice(exchangesBefore).map(withBilling);
  const lines = server.lines.slice(logStart);
  const calls = lines.filter((l) => l.event === "exa_call");
  const log = {
    timestamp: started,
    gitSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    gitDirty: execFileSync("git", ["status", "--porcelain", "--", "src"], { cwd: ROOT, encoding: "utf8" }).trim() !== "",
    question: query.text,
    market: query.market,
    queryId: query.id,
    answerMarketMode,
    httpStatus: res.status,
    finalState: res.status !== 200 ? "rejected" : error ? "failed" : "completed",
    error: error ?? (res.status === 200 ? null : body.slice(0, 300)),
    exaExchanges: exchanges,
    exaCalls: calls.map((c) => ({ stage: c.stage, op: c.op, requestCount: c.requestCount, cacheHit: c.cacheHit ?? false, costDollars: c.costDollars ?? null, errorKind: c.errorKind ?? null, durationMs: c.durationMs })),
    displayed: {
      comparison: text === undefined ? null : { text, sources: ofType(chunks, "source-url").map((c) => ({ sourceId: c.sourceId, url: c.url })) },
      products: ofType(chunks, "data-products")[0]?.data ?? null,
      comparisonTruncated: ofType(chunks, "data-comparison").length > 0,
    },
    progress: ofType(chunks, "data-progress").map((c) => c.data),
    usage: usage ?? null,
    totals: {
      exaRequests: usage?.exaRequests ?? calls.filter((c) => !c.cacheHit).length,
      cacheHits: usage?.cacheHits ?? 0,
      costDollars: usage?.costDollars ?? 0,
    },
    serverLog: lines,
  };
  if (body.includes(keyPrefix)) throw new Error("the key prefix appears in the response; refusing to record it");
  return log;
}

export type QueryLog = Awaited<ReturnType<typeof executeQuery>>;

/** Writes `value` as JSON under `.futari/evidence/live/`, refusing if the key prefix is in it. */
export function writeEvidence(session: SmokeSession, name: string, value: unknown): string {
  const out = JSON.stringify(value, null, 2);
  if (out.includes(session.keyPrefix)) throw new Error("the key prefix appears in the output; refusing to write");
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  writeFileSync(path, `${out}\n`);
  return path;
}

/** Runs one query and writes its log to `.futari/evidence/live/jm-004-smoke-<id>.json`. */
export async function runQuery(session: SmokeSession, query: LiveQuery) {
  const log = await executeQuery(session, query);
  const path = writeEvidence(session, `jm-004-smoke-${query.id}.json`, { task: "JM-004", ...log });
  console.log(`${query.id}: ${log.finalState}, requests ${log.totals.exaRequests}, cost ${log.totals.costDollars}, wrote ${path}`);
  return log;
}
