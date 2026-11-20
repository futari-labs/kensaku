// Live smoke for the vertical slice (JM-004). Runs the built server for real, posts live-acceptance
// queries to POST /api/chat, and writes one run log per query under .futari/evidence/live/.
//
//   pnpm build
//   EXA_ENV_FILE=/path/to/.env.local pnpm exec tsx tests/research/live-smoke.ts Q1 Q2
//
// The server's monthly request limit is forced to 10 and its ledger lives in .cache/, so the total
// across every attempt cannot exceed 10 Exa requests. The key is read only to check, at the end, that
// no output holds its first 8 characters; it is never printed or written.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const OUT_DIR = join(ROOT, ".futari/evidence/live");
const EXCHANGES = join(ROOT, ".cache/smoke/exchanges.jsonl");
const PORT = 8787;
const MAX_REQUESTS = 10;

interface Query {
  id: string;
  market: "US" | "SG" | "JP";
  text: string;
}

const ids = process.argv.slice(2);
const envFile = process.env.EXA_ENV_FILE;
if (!envFile || ids.length === 0) throw new Error("usage: EXA_ENV_FILE=<path> tsx tests/research/live-smoke.ts Q1 [Q2 ...]");
const queries = (JSON.parse(readFileSync(join(ROOT, "evals/cases/live-acceptance.json"), "utf8")) as { queries: Query[] }).queries;
const picked = ids.map((id) => queries.find((q) => q.id === id) ?? (() => { throw new Error(`unknown query ${id}`); })());

process.loadEnvFile(envFile);
const keyPrefix = (process.env.EXA_API_KEY ?? "").slice(0, 8);
if (keyPrefix.length < 8) throw new Error("EXA_API_KEY is missing from the env file");
const answerMarketMode = process.env.KENSAKU_ANSWER_MARKET_MODE ?? "userLocation";

const envWithoutKey = { ...process.env };
delete envWithoutKey.EXA_API_KEY;
const server = spawn(join(ROOT, "node_modules/.bin/tsx"), ["src/server/main.ts"], {
  cwd: ROOT,
  env: {
    ...envWithoutKey,
    EXA_ENV_FILE: envFile,
    NODE_ENV: "production",
    KENSAKU_EXA_MODE: "live",
    KENSAKU_PORT: String(PORT),
    KENSAKU_EXCHANGE_LOG: EXCHANGES,
    KENSAKU_MONTHLY_REQUEST_LIMIT: String(MAX_REQUESTS),
    KENSAKU_ANSWER_MARKET_MODE: answerMarketMode,
  },
});
const serverLines: Record<string, unknown>[] = [];
let partial = "";
server.stdout.on("data", (d: Buffer) => {
  const lines = (partial + d.toString()).split("\n");
  partial = lines.pop() ?? "";
  for (const line of lines) {
    try {
      serverLines.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      serverLines.push({ raw: line.slice(0, 300) });
    }
  }
});
server.stderr.on("data", (d: Buffer) => process.stderr.write(d));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitForServer() {
  for (let i = 0; i < 200; i++) {
    if (serverLines.some((l) => l.event === "listening")) return;
    await sleep(100);
  }
  throw new Error("server did not start");
}

const exchangeCount = () => (existsSync(EXCHANGES) ? readFileSync(EXCHANGES, "utf8").split("\n").filter(Boolean).length : 0);
const readExchanges = () => (existsSync(EXCHANGES) ? readFileSync(EXCHANGES, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []);

type Chunk = { type: string; data?: Record<string, unknown>; [k: string]: unknown };
const parseSse = (text: string): Chunk[] =>
  text.split("\n\n").filter((b) => b.startsWith("data: ") && b !== "data: [DONE]").map((b) => JSON.parse(b.slice(6)) as Chunk);

async function runQuery(query: Query) {
  const logStart = serverLines.length;
  const exchangesBefore = exchangeCount();
  const started = new Date().toISOString();
  const res = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${PORT}` },
    body: JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: query.text }] }], market: query.market }),
  });
  const body = await res.text();
  const chunks = res.headers.get("content-type")?.includes("event-stream") ? parseSse(body) : [];
  const pick = (type: string) => chunks.find((c) => c.type === type);
  const error = pick("data-error")?.data;
  const usage = pick("data-usage")?.data;
  const text = chunks.find((c) => c.type === "text-delta")?.delta;
  const exchanges = readExchanges().slice(exchangesBefore).map((e) => {
    const response = e.response as { requestId?: string; costDollars?: { total?: number } };
    return { ...e, requestId: response.requestId ?? null, costDollars: response.costDollars?.total ?? null };
  });
  const lines = serverLines.slice(logStart);
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
      comparison: text === undefined ? null : { text, sources: chunks.filter((c) => c.type === "source-url").map((c) => ({ sourceId: c.sourceId, url: c.url })) },
      products: pick("data-products")?.data ?? null,
    },
    progress: chunks.filter((c) => c.type === "data-progress").map((c) => c.data),
    usage: usage ?? null,
    totals: {
      exaRequests: (usage as { exaRequests?: number } | undefined)?.exaRequests ?? calls.filter((c) => !c.cacheHit).length,
      cacheHits: (usage as { cacheHits?: number } | undefined)?.cacheHits ?? 0,
      costDollars: (usage as { costDollars?: number } | undefined)?.costDollars ?? 0,
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

try {
  await waitForServer();
  for (const query of picked) {
    const log = await runQuery(query);
    const kind = (log.error as { kind?: string } | null)?.kind;
    if (kind === "credits_exhausted" || kind === "auth") {
      console.error(`stopping: ${kind}`);
      break;
    }
  }
} finally {
  server.kill();
}
