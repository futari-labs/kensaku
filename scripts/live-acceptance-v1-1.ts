// EV-016 live acceptance suite for kensaku-v1-1 (REQ-008, REQ-013, REQ-015, REQ-016): runs Q1-Q8 from
// evals/cases/live-acceptance-v1-1.json against the real Exa API through the built app in Chromium, with an empty Exa
// cache and an empty image cache, then writes the run log and the owner audit sheet under .futari/evidence/live/.
//
//   EXA_ENV_FILE=/path/to/.env.local pnpm live:acceptance:v1-1      (builds first)
//
// Limits (the frozen budget): 5 requests per query, 40 requests and $0.50 per run, and the plan-wide 130 requests and $1.50
// across the committed JM-104 smoke logs and every EV-016 run log. A query starts only if its worst case fits all of them.
// The run log is written after every query, before anything is derived from it; derived fields are added at the end.
// Displayed image bytes and full-page screenshots go outside the repo (KENSAKU_AUDIT_DIR, default the OS temp folder).
// The key is read only to check that no output holds its first 8 characters; it is never printed.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";
import { sniffImage } from "../src/core";
import { ofType, parseSse } from "../tests/server/sse";
import { OUT_DIR, PORT, ROOT, readExchanges, startSmokeServer, withBilling, writeEvidence } from "../tests/research/live-run";
import type { LiveQuery } from "../tests/research/live-run";
import { analyze } from "./live/analyze";
import { renderAuditSheet } from "./live/audit";
import { committedUsage, addUsage, mayStartQuery, serverLimits, usageOfExchanges } from "./live/budget";
import type { Budget, Usage } from "./live/budget";
import { captureQuery } from "./live/browser";
import type { Capture } from "./live/browser";
import { evaluateThresholds } from "./live/thresholds";
import type { ThresholdSpec } from "./live/thresholds";
import type { AnalyzedQuery, ImageProbe, ProductImages, QueryRecord } from "./live/types";

interface Spec {
  queries: LiveQuery[];
  budget: Budget;
  thresholds: ThresholdSpec;
  auditRubric: string[];
  imageAuditRubric: string[];
}
const spec = JSON.parse(readFileSync(join(ROOT, "evals/cases/live-acceptance-v1-1.json"), "utf8")) as Spec;
const { budget } = spec;

const envFile = process.env.EXA_ENV_FILE;
if (!envFile) throw new Error("usage: EXA_ENV_FILE=<path> pnpm live:acceptance:v1-1");

const evidenceFiles = readdirSync(OUT_DIR).filter((f) => f.endsWith(".json"));
const prior: Usage = committedUsage(evidenceFiles.map((name) => ({ name, json: JSON.parse(readFileSync(join(OUT_DIR, name), "utf8")) as unknown })));
const runNumber = evidenceFiles.filter((f) => /^ev-016-run-\d+-.*\.json$/.test(f)).length + 1;
if (runNumber > budget.maxSuiteRuns) throw new Error(`already ${budget.maxSuiteRuns} EV-016 suite runs committed`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const logName = `ev-016-run-${runNumber}-${stamp}.json`;
const auditName = `ev-016-run-${runNumber}-audit.md`;
const auditRoot = process.env.KENSAKU_AUDIT_DIR ?? join(tmpdir(), "kensaku-ev-016");
const imageDir = join(auditRoot, `ev016-run${runNumber}-images`);
const shotDir = join(auditRoot, `ev016-run${runNumber}-shots`);
mkdirSync(imageDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const gitDirty = execFileSync("git", ["status", "--porcelain", "--", "src", "scripts", "tests"], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
const startedAt = new Date().toISOString();
const round = (n: number) => Math.round(n * 1e6) / 1e6;

const limits = serverLimits(budget, prior);
const session = await startSmokeServer(envFile, { maxRequests: limits.requests, maxCostDollars: limits.costDollars, fresh: true });
const serverDir = dirname(session.exchangesPath);
const baseUrl = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch();

const records: QueryRecord[] = [];
const captures = new Map<string, Capture>();
const notRun: { queryId: string; reason: string }[] = [];
let stopped: string | undefined;
let runUsage: Usage = { requests: 0, costDollars: 0 };

/** The probe of one candidate: the proxy's answer to the page, and the proxy's registry entry on disk. */
function probeOf(capture: Capture, candidate: { id: string; sourceHost: string; sourceTitle: string }): ImageProbe {
  const reply = capture.imageReplies.find((r) => r.id === candidate.id);
  let entry: { url?: string; pageUrl?: string; verdict?: unknown } = {};
  try {
    entry = JSON.parse(readFileSync(join(serverDir, ".cache/images", `${candidate.id}.json`), "utf8")) as typeof entry;
  } catch {
    // No registry entry: recorded as null fields.
  }
  return {
    ...candidate,
    requested: reply !== undefined,
    status: reply?.status ?? null,
    contentType: reply?.contentType ?? null,
    sniffed: reply?.status === 200 && reply.body ? sniffImage(reply.body) : null,
    bytes: reply?.body?.length ?? 0,
    imageUrl: entry.url ?? null,
    pageUrl: entry.pageUrl ?? null,
    registryVerdict: entry.verdict ?? null,
  };
}

function recordOf(query: LiveQuery, capture: Capture, logStart: number, exchangesBefore: number, started: string): QueryRecord {
  const chunks = capture.chatBody ? parseSse(capture.chatBody) : [];
  const products = ofType(chunks, "data-products")[0]?.data ?? null;
  const error = ofType(chunks, "data-error")[0]?.data ?? null;
  const usage = ofType(chunks, "data-usage")[0]?.data ?? null;
  const text = ofType(chunks, "text-delta")[0]?.delta;
  const exchanges = readExchanges(session.exchangesPath).slice(exchangesBefore).map(withBilling);
  const lines = session.server.lines.slice(logStart);
  const images: ProductImages[] = (products ?? []).map((product, i) => {
    const src = capture.ui.products[i]?.image.src ?? null;
    return { candidates: (product.imageCandidates ?? []).map((c) => probeOf(capture, c)), loadedId: src?.startsWith("/api/image/") ? src.slice("/api/image/".length) : null };
  });
  return {
    queryId: query.id,
    market: query.market,
    question: query.text,
    startedAt: started,
    gitSha,
    httpStatus: capture.chatStatus,
    finalState: capture.turnState,
    error,
    exaExchanges: exchanges,
    exaCalls: lines.filter((l) => l.event === "exa_call"),
    displayed: {
      comparison: text === undefined ? null : { text, sources: ofType(chunks, "source-url").map((c) => ({ sourceId: c.sourceId, url: c.url })) },
      comparisonTruncated: ofType(chunks, "data-comparison").length > 0,
      products,
    },
    ui: capture.ui,
    images,
    browser: { origins: capture.origins, requestCount: capture.requestCount },
    usage,
    totals: { exaRequests: usage?.exaRequests ?? exchanges.length, costDollars: usage?.costDollars ?? usageOfExchanges(exchanges).costDollars },
    serverLog: lines,
  };
}

/** What stops the run early: Exa credits, authentication, or a server-side limit. */
function stopReason(record: QueryRecord): string | undefined {
  const kind = record.error && typeof record.error === "object" && "kind" in record.error ? String((record.error as { kind: unknown }).kind) : undefined;
  if (kind === "credits_exhausted" || kind === "auth") return `BLOCKED: ${kind}`;
  if (kind === "monthly_limit") return "BLOCKED: server request/cost limit reached";
  return undefined;
}

const header = () => ({
  task: "JM-106",
  evaluation: "EV-016",
  suiteRun: runNumber,
  startedAt,
  gitSha,
  gitDirty,
  freshExaCache: true,
  freshImageCache: true,
  answerMarketMode: session.answerMarketMode,
  budget,
  priorPlanUsage: prior,
  serverLimits: limits,
});

try {
  for (const query of spec.queries) {
    if (stopped) {
      notRun.push({ queryId: query.id, reason: stopped });
      continue;
    }
    const decision = mayStartQuery(budget, prior, runUsage);
    if (!decision.start) {
      stopped = `budget: ${decision.reason}`;
      notRun.push({ queryId: query.id, reason: stopped });
      continue;
    }
    const logStart = session.server.lines.length;
    const exchangesBefore = readExchanges(session.exchangesPath).length;
    const started = new Date().toISOString();
    try {
      const capture = await captureQuery(browser, baseUrl, query.market, query.text);
      const record = recordOf(query, capture, logStart, exchangesBefore, started);
      captures.set(query.id, capture);
      records.push(record);
      runUsage = addUsage(runUsage, usageOfExchanges(record.exaExchanges));
      writeFileSync(join(shotDir, `${query.id}.png`), capture.screenshot);
      console.log(`${query.id}: ${record.finalState}, requests ${record.exaExchanges.length}, cost ${round(usageOfExchanges(record.exaExchanges).costDollars)}`);
      if (record.exaExchanges.length > budget.maxRequestsPerQuery) stopped = `limit: ${query.id} made ${record.exaExchanges.length} requests`;
      else stopped = stopReason(record);
    } catch (error) {
      // The Exa calls of a query that crashed in the browser are still paid for: count them from the exchange log.
      const spent = usageOfExchanges(readExchanges(session.exchangesPath).slice(exchangesBefore).map(withBilling));
      runUsage = addUsage(runUsage, spent);
      stopped = `unexpected: ${error instanceof Error ? error.message : String(error)} (${spent.requests} request(s) spent)`;
      notRun.push({ queryId: query.id, reason: stopped });
    }
    // Written before any post-processing: a crash after this line cannot drop a paid query.
    writeEvidence(session, logName, { ...header(), finished: false, stopped: stopped ?? null, queriesNotRun: notRun, queries: records, totals: { ...runUsage } });
  }
} finally {
  await browser.close();
  session.server.stop();
}

const analyzed: AnalyzedQuery[] = records.map(analyze);
const thresholds = evaluateThresholds(spec.thresholds, analyzed, notRun);
for (const q of analyzed) {
  for (const image of q.analysis.images) {
    const reply = captures.get(q.queryId)?.imageReplies.find((r) => r.id === image.candidateId && r.status === 200);
    if (reply?.body) writeFileSync(join(imageDir, image.file), reply.body);
  }
}
const final = {
  ...header(),
  finished: true,
  finishedAt: new Date().toISOString(),
  stopped: stopped ?? null,
  queriesNotRun: notRun,
  totals: { requests: runUsage.requests, reportedCostDollars: runUsage.costDollars },
  planWideAfterRun: addUsage(prior, runUsage),
  thresholds: { deterministic: thresholds, ownerAudit: "pending: displayedOffersPassingOwnerAudit and displayedImagesPassingOwnerAudit are filled from the audit sheet" },
  queries: analyzed,
};
const logPath = writeEvidence(session, logName, final);

const audit = renderAuditSheet({ runNumber, logFile: logName, gitSha, imageDir, shotDir, auditRubric: spec.auditRubric, imageAuditRubric: spec.imageAuditRubric }, analyzed);
if (audit.includes(session.keyPrefix)) throw new Error("the key prefix appears in the audit sheet; refusing to write");
const auditPath = join(OUT_DIR, auditName);
writeFileSync(auditPath, audit);

// Last check: no file under the evidence folder holds the key prefix.
for (const f of readdirSync(OUT_DIR)) {
  if (readFileSync(join(OUT_DIR, f), "utf8").includes(session.keyPrefix)) throw new Error(`the key prefix appears in ${f}`);
}
for (const t of thresholds) console.log(`${t.pass ? "PASS" : "FAIL"} ${t.name}: ${t.actual} (required ${t.required})`);
console.log(JSON.stringify({ logPath, auditPath, imageDir, shotDir, stopped: final.stopped, totals: final.totals, planWideAfterRun: final.planWideAfterRun }, null, 2));
process.exitCode = stopped || thresholds.some((t) => !t.pass) ? 1 : 0;
