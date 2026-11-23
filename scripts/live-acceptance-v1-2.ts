// EV-023, the kensaku-v1-2 live sandbox acceptance (evals/cases/live-acceptance-v1-2.json). Local only, never in CI.
//
//   pnpm live:acceptance:v1-2 --dry-run
//       The whole flow against a fake checkout port and fixture research. No network, no Stripe, no Exa, writes nothing.
//
//   (terminal 1)  stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed --forward-to http://127.0.0.1:8787/api/stripe/webhook
//   (terminal 2)  rm -rf .data/commerce && mkdir -p .cache/live && pnpm start 2>&1 | tee .cache/live/ev023-server.log     (pnpm start builds; live Exa mode)
//   (terminal 3)  pnpm live:acceptance:v1-2 --server-log .cache/live/ev023-server.log
//   afterwards    pnpm live:acceptance:v1-2 --finalize-audit .futari/evidence/live/ev-023-run-<n>-<UTC>.json
//
// The script does not build or start anything: it checks the frozen preconditions and stops before any Exa request when one fails.
// Research (Q1, Q3, Q5) spends at most 5 Exa requests per attempt, one re-ask per query, 25 for EV-023 and 30 plan-wide, counted in
// .cache/live/v1-2-exa-counter.json. Scenarios A1-A5 print the Stripe-hosted URL and the steps for the owner and wait for the order
// to leave "open"; the script never touches the hosted page. A6-A8 run by themselves. The run log goes to
// .futari/evidence/live/ev-023-run-<n>-<UTC>.json with an audit sheet ev-023-run-<n>-audit.md for the owner's H1-H5 answers.
// --finalize-audit reads the filled sheet and sets ownerAuditAllYes and the verdict in the log. At most 2 runs.
// No key, secret, signature or card number is written; the owner instructions print card numbers from the frozen case file.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { AcceptanceAbort, runAcceptance } from "./live/acceptance";
import { dryAcceptanceEnv, liveAcceptanceEnv } from "./live/acceptance-env";
import { AUDIT_IDS, auditAllYes, auditFileName, EVIDENCE_DIR, leakProblems, loadCase, nextRunNumber, parseAudit, renderAuditTemplate, runNumberOfLog, runVerdict, RunLimitError } from "./live/acceptance-log";
import type { RunLog } from "./live/acceptance-log";
import { redact, SmokeAbort } from "./live/sandbox-smoke";

const DEFAULT_TIMEOUT_MINUTES = 20;

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "server-log": { type: "string" },
    "timeout-minutes": { type: "string", default: String(DEFAULT_TIMEOUT_MINUTES) },
    "finalize-audit": { type: "string" },
  },
});

function writeChecked(path: string, text: string): void {
  const problems = leakProblems(text);
  if (problems.length > 0) throw new Error(`${basename(path)} holds ${problems.join(" and ")}; refusing to write it`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function summarize(log: RunLog): void {
  const t = log.thresholds;
  console.log(`\nrun ${log.run} (${log.mode}) at ${log.gitSha}${log.gitDirty ? " (dirty tree)" : ""}`);
  for (const s of log.scenarios) console.log(`  ${s.id}: ${s.verdict}${s.verdict === "PASS" ? "" : ` ${JSON.stringify({ failed: Object.entries(s.checks).filter(([, ok]) => !ok).map(([n]) => n), notes: s.notes })}`}`);
  for (const r of log.exa.perQuery) console.log(`  ${r.id}: ${r.requests} Exa request(s), $${r.costDollars}, ${r.addableOffers} addable offer(s), checks ${JSON.stringify(r.checks)}`);
  console.log(`  thresholds: ${JSON.stringify(t)}`);
  console.log(`  Exa: EV-023 ${log.exa.ev023Requests} of ${log.exa.caps.ev023}, plan-wide ${log.exa.planRequestsAfter} of ${log.exa.caps.planWide}`);
  console.log(`  verdict: ${log.verdict}${log.verdict === "PENDING_AUDIT" ? " (ownerAuditAllYes is PENDING until the owner's H1-H5 answers are recorded)" : ""}`);
}

function finalizeAudit(logPath: string): number {
  const log = JSON.parse(readFileSync(logPath, "utf8")) as RunLog;
  const run = runNumberOfLog(logPath) ?? log.run;
  const auditPath = join(dirname(logPath), auditFileName(run));
  if (!existsSync(auditPath)) throw new AcceptanceAbort(`${auditPath} does not exist: the run writes it, and the coordinator fills it from the owner's answers.`);
  const auditText = readFileSync(auditPath, "utf8");
  const problems = leakProblems(auditText);
  if (problems.length > 0) throw new AcceptanceAbort(`the audit sheet holds ${problems.join(" and ")}; remove it first`);
  const answers = parseAudit(auditText);
  const next: RunLog = { ...log, ownerAudit: answers, thresholds: { ...log.thresholds, ownerAuditAllYes: auditAllYes(answers) } };
  next.verdict = runVerdict(next.thresholds, next.researchChecksPass);
  writeChecked(logPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`audit: ${AUDIT_IDS.map((id) => `${id}=${answers[id]}`).join(" ")}`);
  console.log(`${basename(logPath)}: ownerAuditAllYes=${String(next.thresholds.ownerAuditAllYes)}, verdict ${next.verdict}`);
  return next.verdict === "PASS" ? 0 : 1;
}

try {
  if (values["finalize-audit"]) process.exit(finalizeAudit(values["finalize-audit"]));

  const c = loadCase();
  const dry = values["dry-run"];
  if (!dry && !values["server-log"]) throw new AcceptanceAbort("--server-log <file> is required: the server's output, saved to a file (see the header of this script).");
  const timeoutMinutes = Number(values["timeout-minutes"]);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) throw new AcceptanceAbort("--timeout-minutes must be a positive number.");
  const env = dry ? dryAcceptanceEnv(console.log) : liveAcceptanceEnv({ serverLogPath: values["server-log"]!, ownerTimeoutMs: timeoutMinutes * 60_000 });
  const run = dry ? 0 : nextRunNumber(existsSync(EVIDENCE_DIR) ? readdirSync(EVIDENCE_DIR) : []);
  if (!dry) console.log(`EV-023 run ${run} of at most 2.`);

  const log = await runAcceptance(env, c, run);
  summarize(log);
  if (dry) process.exit(log.scenarios.every((s) => s.verdict === "PASS") && log.verdict !== "FAIL" ? 0 : 1);

  const stamp = log.finishedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const logFile = `ev-023-run-${run}-${stamp}.json`;
  writeChecked(join(EVIDENCE_DIR, logFile), `${JSON.stringify(log, null, 2)}\n`);
  const auditPath = join(EVIDENCE_DIR, auditFileName(run));
  writeChecked(auditPath, renderAuditTemplate({ run, logFile, gitSha: log.gitSha, questions: c.ownerAudit }));
  console.log(`\nwrote .futari/evidence/live/${logFile}\nwrote .futari/evidence/live/${auditFileName(run)}`);
  console.log("\nOwner audit (H1-H5). Ask the owner each question and record yes or no in the audit sheet:");
  for (const question of c.ownerAudit) console.log(`  ${question}`);
  console.log(`\nThen run: pnpm live:acceptance:v1-2 --finalize-audit .futari/evidence/live/${logFile}`);
  process.exit(log.verdict === "FAIL" ? 1 : 0);
} catch (error) {
  const expected = error instanceof SmokeAbort || error instanceof RunLimitError;
  console.error(expected ? `EV-023 stopped: ${(error as Error).message}` : `EV-023 failed: ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exit(2);
}
