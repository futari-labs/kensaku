// The live smoke as a module, importable by JM-006 (see live-smoke.ts for the runnable entry). It
// runs the real server against live Exa, posts live-acceptance queries to POST /api/chat, and writes
// one run log per query under .futari/evidence/live/. Importing this file starts nothing.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Market } from "../../src/core/types";
import { ofType, parseSse } from "../server/sse";
import { spawnServer } from "../server/process";
import type { ServerProcess } from "../server/process";

export const ROOT = join(import.meta.dirname, "../..");
const OUT_DIR = join(ROOT, ".futari/evidence/live");
const EXCHANGES = join(ROOT, ".cache/smoke/exchanges.jsonl");
export const PORT = 8787;
/** The server's monthly request limit during a smoke run, so every attempt together stays under it. */
export const MAX_REQUESTS = 10;

export interface LiveQuery {
  id: string;
  market: Market;
  text: string;
}

export function loadQueries(ids: string[]): LiveQuery[] {
  const queries = (JSON.parse(readFileSync(join(ROOT, "evals/cases/live-acceptance.json"), "utf8")) as { queries: LiveQuery[] }).queries;
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
}

/**
 * Loads the key file into this process, then starts the server without the key in its environment
 * (it reads the file itself), with a request limit of `MAX_REQUESTS` and the exchange log on.
 */
export async function startSmokeServer(envFile: string): Promise<SmokeSession> {
  process.loadEnvFile(envFile);
  const keyPrefix = (process.env.EXA_API_KEY ?? "").slice(0, 8);
  if (keyPrefix.length < 8) throw new Error("EXA_API_KEY is missing from the env file");
  const answerMarketMode = process.env.KENSAKU_ANSWER_MARKET_MODE ?? "userLocation";
  const env = { ...process.env };
  delete env.EXA_API_KEY;
  const server = await spawnServer({
    ...env,
    EXA_ENV_FILE: envFile,
    NODE_ENV: "production",
    KENSAKU_EXA_MODE: "live",
    KENSAKU_PORT: String(PORT),
    KENSAKU_EXCHANGE_LOG: EXCHANGES,
    KENSAKU_MONTHLY_REQUEST_LIMIT: String(MAX_REQUESTS),
    KENSAKU_ANSWER_MARKET_MODE: answerMarketMode,
  });
  return { server, keyPrefix, answerMarketMode };
}

const readExchanges = (): Record<string, unknown>[] =>
  existsSync(EXCHANGES) ? readFileSync(EXCHANGES, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];

/** Runs one query through the server and writes its log to `.futari/evidence/live/jm-004-smoke-<id>.json`. */
export async function runQuery({ server, keyPrefix, answerMarketMode }: SmokeSession, query: LiveQuery) {
  const logStart = server.lines.length;
  const exchangesBefore = readExchanges().length;
  const started = new Date().toISOString();
  const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${PORT}` },
    body: JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: query.text }] }], market: query.market }),
  });
  const body = await res.text();
  const chunks = res.headers.get("content-type")?.includes("event-stream") ? parseSse(body) : [];
  const error = ofType(chunks, "data-error")[0]?.data;
  const usage = ofType(chunks, "data-usage")[0]?.data;
  const text = ofType(chunks, "text-delta")[0]?.delta;
  const exchanges = readExchanges().slice(exchangesBefore).map((e) => {
    const response = e.response as { requestId?: string; costDollars?: { total?: number } };
    return { ...e, requestId: response.requestId ?? null, costDollars: response.costDollars?.total ?? null };
  });
  const lines = server.lines.slice(logStart);
  const calls = lines.filter((l) => l.event === "exa_call");
  const log = {
    task: "JM-004",
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
  const out = JSON.stringify(log, null, 2);
  if (out.includes(keyPrefix) || body.includes(keyPrefix)) throw new Error("the key prefix appears in the output; refusing to write");
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `jm-004-smoke-${query.id}.json`);
  writeFileSync(path, `${out}\n`);
  console.log(`${query.id}: ${log.finalState}, requests ${log.totals.exaRequests}, cost ${log.totals.costDollars}, wrote ${path}`);
  return log;
}
