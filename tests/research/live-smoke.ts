// Runnable entry for the live smoke (JM-004). Posts live-acceptance queries to the built server and
// writes one run log per query under .futari/evidence/live/. The logic lives in live-run.ts.
//
//   pnpm build
//   EXA_ENV_FILE=/path/to/.env.local pnpm exec tsx tests/research/live-smoke.ts Q1 Q2
//
// The server's monthly request limit is forced to 10 and its ledger lives in .cache/, so the total
// across every attempt cannot exceed 10 Exa requests. The key is read only to check, at the end, that
// no output holds its first 8 characters; it is never printed or written.
import { loadQueries, runQuery, startSmokeServer } from "./live-run";

const ids = process.argv.slice(2);
const envFile = process.env.EXA_ENV_FILE;
if (!envFile || ids.length === 0) throw new Error("usage: EXA_ENV_FILE=<path> tsx tests/research/live-smoke.ts Q1 [Q2 ...]");
const queries = loadQueries(ids);

const session = await startSmokeServer(envFile);
try {
  for (const query of queries) {
    const log = await runQuery(session, query);
    const kind = log.error && typeof log.error === "object" && "kind" in log.error ? log.error.kind : undefined;
    if (kind === "credits_exhausted" || kind === "auth") {
      console.error(`stopping: ${kind}`);
      break;
    }
  }
} finally {
  session.server.stop();
}
