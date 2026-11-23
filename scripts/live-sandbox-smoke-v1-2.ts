// The JM-203 sandbox smoke for kensaku-v1-2 (docs/futari/EVALUATION_PLAN.md, "Slice smoke (JM-203, v1.2)").
//
//   tsx scripts/live-sandbox-smoke-v1-2.ts --dry-run
//       The whole flow against a fake port and an in-process fixture app. No network, no Stripe, no Exa, writes nothing.
//
//   pnpm build
//   (terminal 1)  stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed --forward-to http://127.0.0.1:8787/api/stripe/webhook
//   (terminal 2)  mkdir -p .cache/smoke && pnpm start 2>&1 | tee .cache/smoke/server.log        (live Exa mode, empty .data/commerce/)
//   (terminal 3)  tsx scripts/live-sandbox-smoke-v1-2.ts --server-log .cache/smoke/server.log
//
// Reads STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and EXA_API_KEY from .env.local or EXA_ENV_FILE, like the server, and
// refuses to run unless the Stripe key is a sandbox key. Spends at most 5 Exa requests (one Q1 research run through the
// server), or none with --offer-id <id> for offers registered earlier (repeat the flag for SGD and JPY). It creates, retrieves
// and expires USD, SGD and JPY sessions, then asks the owner to pay (4242) and to decline (4000 0000 0000 0002) on the
// Stripe-hosted page, waiting for the order state to change rather than for pasted input, and finally runs
// `stripe events resend` on the paid event. The log goes to .futari/evidence/live/jm-203-sandbox-smoke-<UTC>.json
// (--out to change it). No key, secret, signature or card number is printed or recorded.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { dryEnv, liveEnv } from "./live/sandbox-env";
import { holdsKey, redact, runSmoke, SmokeAbort } from "./live/sandbox-smoke";
import type { SmokeEnv } from "./live/sandbox-smoke";

const ROOT = join(import.meta.dirname, "..");
const DEFAULT_TIMEOUT_MINUTES = 10;

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "server-log": { type: "string" },
    "offer-id": { type: "string", multiple: true, default: [] },
    "timeout-minutes": { type: "string", default: String(DEFAULT_TIMEOUT_MINUTES) },
    out: { type: "string" },
  },
});

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
try {
  const dry = values["dry-run"];
  if (!dry && !values["server-log"]) throw new SmokeAbort("--server-log <file> is required: the server's output, saved to a file (see the header of this script).");
  const env: SmokeEnv = dry
    ? dryEnv()
    : liveEnv({ offerIds: values["offer-id"] ?? [], serverLogPath: values["server-log"]!, ownerTimeoutMs: Number(values["timeout-minutes"]) * 60_000 });
  const evidence = await runSmoke(env);
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  if (holdsKey(text)) throw new Error("the log holds a key-shaped value; refusing to write it");

  const failed = Object.entries(evidence.checks).filter(([, ok]) => !ok);
  if (evidence.mode === "dry-run") {
    console.log(`dry-run: ${Object.keys(evidence.checks).length} checks, ${failed.length} failed`);
    for (const [name] of failed) console.log(`  FAILED: ${name}`);
    process.exit(failed.length === 0 ? 0 : 1);
  }
  const out = values.out ?? join(ROOT, ".futari/evidence/live", `jm-203-sandbox-smoke-${stamp}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`\nwrote ${out}`);
  for (const [name, ok] of Object.entries(evidence.checks)) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  process.exit(evidence.pass ? 0 : 1);
} catch (error) {
  console.error(error instanceof SmokeAbort ? `smoke stopped: ${error.message}` : `smoke failed: ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exit(2);
}
