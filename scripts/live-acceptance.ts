// EV-008 live acceptance suite (REQ-008, D-007): runs Q1-Q6 from evals/cases/live-acceptance.json
// against the real Exa API through the built server (POST /api/chat) with a fresh cache, then writes
// the run log and the owner-audit sheet under .futari/evidence/live/.
//
//   pnpm build   (run by `pnpm live:acceptance`)
//   EXA_ENV_FILE=/path/to/.env.local pnpm live:acceptance
//
// Hard limits (live-acceptance.json budget): 5 requests per query, 30 requests and $0.40 per run, stop
// on a 402 or any credit/auth error. The server's own ledger enforces the same request and cost limits.
// The key is read only to check that no output holds its first 8 characters; it is never printed.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCitations } from "../src/core";
import { parseAnswerResponse } from "../src/exa/parse";
import { OUT_DIR, ROOT, executeQuery, loadQueries, startSmokeServer, writeEvidence } from "../tests/research/live-run";
import type { LiveQuery, QueryLog, SmokeSession } from "../tests/research/live-run";
import { revalidateRun } from "../tests/research/revalidate";
import type { Revalidation } from "../tests/research/revalidate";

interface Spec {
  budget: { maxRequestsPerQuery: number; maxRequestsPerSuiteRun: number; maxSuiteRuns: number; maxReportedCostDollarsPerSuiteRun: number };
  thresholds: { queriesWithAtLeastOneMerchantOffer: { min: number; of: number } };
  auditRubric: string[];
  queries: LiveQuery[];
}
const spec = JSON.parse(readFileSync(join(ROOT, "evals/cases/live-acceptance.json"), "utf8")) as Spec;
const { budget } = spec;

const envFile = process.env.EXA_ENV_FILE;
if (!envFile) throw new Error("usage: EXA_ENV_FILE=<path> pnpm live:acceptance");

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const runNumber = readdirSync(OUT_DIR).filter((f) => /^ev-008-run-\d+-.*\.json$/.test(f)).length + 1;
if (runNumber > budget.maxSuiteRuns) throw new Error(`already ${budget.maxSuiteRuns} suite runs committed`);
const logName = `ev-008-run-${runNumber}-${stamp}.json`;
const auditName = `ev-008-run-${runNumber}-audit.md`;

const exchangeCost = (e: unknown): number => ((e as { costDollars?: number | null }).costDollars ?? 0);
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** What stops the run early: an Exa credit/auth failure (HTTP 402 included) or a limit. */
function stopReason(log: QueryLog): string | undefined {
  const kind = log.error && typeof log.error === "object" && "kind" in log.error ? String(log.error.kind) : undefined;
  if (log.httpStatus === 402 || kind === "credits_exhausted" || kind === "auth") return `BLOCKED: ${kind ?? "HTTP 402"}`;
  if (kind === "monthly_limit") return "BLOCKED: server request/cost limit reached";
  return undefined;
}

function citationsOf(log: QueryLog) {
  const answer = log.exaExchanges.find((e) => e.endpoint === "/answer");
  if (!answer) return null;
  const parsed = parseAnswerResponse(answer.response);
  const r = resolveCitations(parsed.comparison, parsed.citationUrls);
  return {
    resolvedUrlCount: r.sources.length,
    unresolvedMarkers: r.unresolvedMarkers,
    uncitedParagraphs: r.uncitedParagraphs,
    displayedTextEqualsRecomputed: log.displayed.comparison?.text === r.renderedText,
  };
}

const session: SmokeSession = await startSmokeServer(envFile, {
  maxRequests: budget.maxRequestsPerSuiteRun,
  maxCostDollars: budget.maxReportedCostDollarsPerSuiteRun,
  fresh: true,
});

const startedAt = new Date().toISOString();
const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const queryLogs: (QueryLog & { revalidation: Revalidation; citations: ReturnType<typeof citationsOf> })[] = [];
const notRun: { queryId: string; reason: string }[] = [];
let stopped: string | undefined;
let requests = 0;
let cost = 0;

function snapshot(finished: boolean) {
  const offers = queryLogs.flatMap((q) => q.revalidation.offers);
  const reproduced = offers.filter((o) => o.reproduced).length;
  const unexpected = queryLogs.filter((q) => q.finalState !== "completed").length + notRun.length;
  const withOffers = queryLogs.filter((q) => q.revalidation.offers.length > 0).length;
  const { min, of } = spec.thresholds.queriesWithAtLeastOneMerchantOffer;
  return {
    task: "JM-006",
    evaluation: "EV-008",
    suiteRun: runNumber,
    finished,
    startedAt,
    finishedAt: new Date().toISOString(),
    gitSha,
    freshCache: true,
    answerMarketMode: session.answerMarketMode,
    budget,
    stopped: stopped ?? null,
    queriesNotRun: notRun,
    queries: queryLogs,
    totals: { requests, cacheHits: queryLogs.reduce((n, q) => n + q.totals.cacheHits, 0), reportedCostDollars: round(cost) },
    thresholds: {
      queriesWithAtLeastOneMerchantOffer: { actual: withOffers, min, of, pass: withOffers >= min },
      displayedOffersPassingRevalidation: { offers: offers.length, reproduced, pass: reproduced === offers.length },
      fabricatedOffers: { actual: offers.filter((o) => !o.fromRun).length, max: 0 },
      unexpectedErrorRuns: { actual: unexpected, max: 0 },
      requests: { actual: requests, max: budget.maxRequestsPerSuiteRun },
      reportedCostDollars: { actual: round(cost), max: budget.maxReportedCostDollarsPerSuiteRun },
      displayedOffersPassingOwnerAudit: "pending owner audit (see the audit sheet)",
    },
  };
}

try {
  for (const query of loadQueries(spec.queries.map((q) => q.id))) {
    if (stopped) {
      notRun.push({ queryId: query.id, reason: stopped });
      continue;
    }
    if (requests + budget.maxRequestsPerQuery > budget.maxRequestsPerSuiteRun || cost >= budget.maxReportedCostDollarsPerSuiteRun) {
      stopped = `limit: ${requests} requests and $${round(cost)} used, next query could exceed the run limit`;
      notRun.push({ queryId: query.id, reason: stopped });
      continue;
    }
    const log = await executeQuery(session, query).catch((error: unknown) => {
      stopped = `unexpected: ${error instanceof Error ? error.message : String(error)}`;
      return undefined;
    });
    if (!log) {
      notRun.push({ queryId: query.id, reason: stopped ?? "unexpected" });
      continue;
    }
    const queryRequests = log.exaExchanges.length;
    const queryCost = log.exaExchanges.reduce((n, e) => n + exchangeCost(e), 0);
    requests += queryRequests;
    cost += queryCost;
    queryLogs.push({ ...log, revalidation: revalidateRun(log), citations: citationsOf(log) });
    console.log(`${query.id}: ${log.finalState}, requests ${queryRequests}, cost ${round(queryCost)}`);
    if (queryRequests > budget.maxRequestsPerQuery) stopped = `limit: ${query.id} made ${queryRequests} requests`;
    else if (cost > budget.maxReportedCostDollarsPerSuiteRun) stopped = `limit: reported cost $${round(cost)}`;
    else stopped = stopReason(log);
    writeEvidence(session, logName, snapshot(false));
  }
} finally {
  session.server.stop();
}

const final = snapshot(true);
const logPath = writeEvidence(session, logName, final);

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const rows: string[] = [];
for (const q of queryLogs) {
  q.revalidation.offers.forEach((o, i) => {
    const price = `${o.offer.price.amount} ${o.offer.price.currency}`;
    const check = o.reproduced ? "pass" : `FAIL: ${o.problem ?? "not reproduced"}`;
    rows.push(
      `| ${q.queryId}-O${i + 1} | ${q.queryId} | ${cell(`${o.candidate.brand} ${o.candidate.name}`)} | ${o.offer.merchantHost} | ${price} | ${o.offer.availability} | ${o.offer.canonicalUrl} | ${cell(o.offer.productName ?? "")} | pending owner | pending owner | ${check} |`,
    );
  });
}
const citationLines = queryLogs.map((q) => {
  const c = q.citations;
  return c
    ? `- ${q.queryId}: ${c.resolvedUrlCount} resolved source URL(s), ${c.unresolvedMarkers} unresolved marker(s), uncited paragraph indexes [${c.uncitedParagraphs.join(", ")}], displayed text equals the recomputed rendering: ${c.displayedTextEqualsRecomputed}`
    : `- ${q.queryId}: no comparison (${q.finalState})`;
});
const queryLines = queryLogs.map((q) => `- ${q.queryId} (${q.market}): ${q.finalState}, ${q.exaExchanges.length} request(s), ${q.revalidation.offers.length} offer(s) displayed`);
const audit = [
  `# EV-008 run ${runNumber} owner audit sheet`,
  "",
  `Run log: ${join(".futari/evidence/live", logName)} (git ${gitSha}, ${startedAt}).`,
  "",
  "Rubric (evals/cases/live-acceptance.json auditRubric):",
  ...spec.auditRubric.map((r) => `- ${r}`),
  "",
  "Threshold: at least 90% of all displayed offers pass all three checks. Only the owner fills Right product and Direct merchant. Price display is prefilled from the revalidation of the recorded Exa responses.",
  "",
  "## Displayed offers",
  "",
  "| ID | Query | Candidate | Merchant host | Price | Availability | URL | Page title (Exa) | Right product | Direct merchant | Price display |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
  `Total displayed offers: ${rows.length}.`,
  "",
  "## Queries",
  "",
  ...queryLines,
  "",
  "## Comparison citations",
  "",
  ...citationLines,
  "",
].join("\n");
const auditPath = join(OUT_DIR, auditName);
if (audit.includes(session.keyPrefix)) throw new Error("the key prefix appears in the audit sheet; refusing to write");
writeFileSync(auditPath, audit);

// Last check: no file under the evidence folder holds the key prefix.
for (const f of readdirSync(OUT_DIR)) {
  if (readFileSync(join(OUT_DIR, f), "utf8").includes(session.keyPrefix)) throw new Error(`the key prefix appears in ${f}`);
}
console.log(JSON.stringify({ logPath, auditPath, stopped: final.stopped, totals: final.totals, thresholds: final.thresholds }, null, 2));
process.exitCode = stopped ? 1 : 0;
