import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { AcceptanceAbort, runAcceptance } from "./live/acceptance";
import { dryAcceptanceEnv, liveAcceptanceEnv } from "./live/acceptance-env";
import {
  AUDIT_IDS,
  auditFileName,
  EVIDENCE_DIR,
  leakProblems,
  loadCase,
  logFileName,
  nextRunNumber,
  parseAudit,
  parseRunLog,
  renderAuditTemplate,
  renderStub,
  runNumberOfLog,
  RunLimitError,
  safeLogText,
  withOwnerAudit,
} from "./live/acceptance-log";
import type { RunLog, RunVerdict } from "./live/acceptance-log";
import { gitSha } from "./live/sandbox-env";
import { redact, SmokeAbort } from "./live/sandbox-smoke";

const DEFAULT_TIMEOUT_MINUTES = 20;
const CASE_FILE = "evals/cases/live-acceptance-v1-2.json";
const README_SECTION = "README.md, section \"Live sandbox acceptance (EV-023)\"";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "server-log": { type: "string" },
    "timeout-minutes": { type: "string", default: String(DEFAULT_TIMEOUT_MINUTES) },
    "finalize-audit": { type: "string" },
  },
});

const EXIT_CODE: Record<RunVerdict, number> = { PASS: 0, PENDING_AUDIT: 0, FAIL: 1, BLOCKED: 3 };

function writeChecked(path: string, text: string): void {
  const problems = leakProblems(text);
  if (problems.length > 0) throw new Error(`${basename(path)} holds ${problems.join(" and ")}; refusing to write it`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function summarize(log: RunLog): void {
  console.log(`\nrun ${log.run} (${log.mode}, ${log.status}) at ${log.gitSha}${log.gitDirty ? " (dirty tree)" : ""}`);
  for (const s of log.scenarios) console.log(`  ${s.id}: ${s.verdict}${s.verdict === "PASS" ? "" : ` ${JSON.stringify({ failed: Object.entries(s.checks).filter(([, ok]) => !ok).map(([n]) => n), notes: s.notes })}`}`);
  for (const r of log.exa.perQuery) console.log(`  ${r.id}: ${r.requests} Exa request(s), $${r.costDollars}, ${r.addableOffers} addable offer(s), checks ${JSON.stringify(r.checks)}`);
  for (const note of log.notes) console.log(`  note: ${note}`);
  console.log(`  thresholds: ${JSON.stringify(log.thresholds)}`);
  console.log(`  Exa: EV-023 ${log.exa.ev023Requests} of ${log.exa.caps.ev023}, plan-wide ${log.exa.planRequestsAfter} of ${log.exa.caps.planWide} requests and $${log.exa.planCostDollarsAfter} of $${log.exa.caps.planWideCostDollars}`);
  console.log(`  verdict: ${log.verdict}${log.verdict === "PENDING_AUDIT" ? " (not acceptance yet: run --finalize-audit once the owner's H1-H5 answers are recorded)" : ""}`);
}

function finalizeAudit(logPath: string): number {
  const log = parseRunLog(readFileSync(logPath, "utf8"));
  const run = runNumberOfLog(logPath) ?? log.run;
  const auditPath = join(dirname(logPath), auditFileName(run));
  if (!existsSync(auditPath)) throw new AcceptanceAbort(`${auditPath} does not exist: the run writes it, and the coordinator fills it from the owner's answers.`);
  const auditText = readFileSync(auditPath, "utf8");
  const problems = leakProblems(auditText);
  if (problems.length > 0) throw new AcceptanceAbort(`the audit sheet holds ${problems.join(" and ")}; remove it first`);
  const answers = parseAudit(auditText);
  const next = withOwnerAudit(log, answers);
  writeFileSync(logPath, safeLogText(next));
  console.log(`audit: ${AUDIT_IDS.map((id) => `${id}=${answers[id]}`).join(" ")}`);
  console.log(`${basename(logPath)}: ownerAuditAllYes=${String(next.thresholds.ownerAuditAllYes)}, verdict ${next.verdict}`);
  return next.verdict === "PASS" ? 0 : next.verdict === "BLOCKED" ? 3 : 1;
}

async function main(): Promise<number> {
  const finalize = values["finalize-audit"];
  if (finalize) return finalizeAudit(finalize);

  const c = loadCase();
  console.log(`EV-023 case file: ${CASE_FILE} (${c.scenarios.length} scenarios, ${c.queries.length} queries)`);
  const timeoutMinutes = Number(values["timeout-minutes"]);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) throw new AcceptanceAbort("--timeout-minutes must be a positive number.");
  if (values["dry-run"]) {
    const log = await runAcceptance(dryAcceptanceEnv(console.log), c, 0);
    summarize(log);
    return log.status === "complete" && log.scenarios.every((s) => s.verdict === "PASS") && log.verdict === "PENDING_AUDIT" ? 0 : 1;
  }
  const serverLog = values["server-log"];
  if (!serverLog) throw new AcceptanceAbort(`--server-log <file> is required: the server's output, saved to a file (see ${README_SECTION}).`);

  const env = liveAcceptanceEnv({ serverLogPath: serverLog, ownerTimeoutMs: timeoutMinutes * 60_000 });
  const run = nextRunNumber(existsSync(EVIDENCE_DIR) ? readdirSync(EVIDENCE_DIR) : []);
  console.log(`EV-023 run ${run} of at most 2.`);

  const log = await runAcceptance(env, c, run, (startedAt) => {
    const file = logFileName(run, startedAt);
    writeChecked(join(EVIDENCE_DIR, file), renderStub({ mode: "live", run, gitSha: gitSha(), startedAt }));
    console.log(`reserved run ${run}: .futari/evidence/live/${file}`);
  });
  summarize(log);

  const logFile = logFileName(run, log.startedAt);
  const text = safeLogText(log);
  try {
    writeFileSync(join(EVIDENCE_DIR, logFile), text);
  } catch (error) {
    console.error(`could not write the run log (${redact(error instanceof Error ? error.message : String(error))}); it is printed here instead:\n${text}`);
    return 2;
  }
  console.log(`\nwrote .futari/evidence/live/${logFile}`);
  if (log.status === "complete") {
    writeChecked(join(EVIDENCE_DIR, auditFileName(run)), renderAuditTemplate({ run, logFile, gitSha: log.gitSha, questions: c.ownerAudit }));
    console.log(`wrote .futari/evidence/live/${auditFileName(run)}`);
    console.log("\nOwner audit (H1-H5). Ask the owner each question and record yes or no in the audit sheet:");
    for (const question of c.ownerAudit) console.log(`  ${question}`);
    console.log(`\nA live run that exits 0 is not acceptance. Then run: pnpm live:acceptance:v1-2 --finalize-audit .futari/evidence/live/${logFile}`);
  }
  return log.status === "aborted" ? 2 : EXIT_CODE[log.verdict];
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const expected = error instanceof SmokeAbort || error instanceof RunLimitError;
    console.error(expected ? `EV-023 stopped: ${(error as Error).message}` : `EV-023 failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exit(2);
  },
);
