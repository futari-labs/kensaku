#!/usr/bin/env node
// Kensaku evaluation harness (pre-implementation). Node >= 22, no dependencies.
//
// It reports three distinct states per evaluation and never conflates them:
//   HARNESS OK      the frozen cases and fixtures are internally valid
//   NOT RUNNABLE    the product code or test file the evaluation needs does not exist yet
//   READY           the evaluation's test file exists; run its listed command to get PASS/FAIL
// It does not run product tests and never reports a product PASS.
//
// Usage: node evals/harness.mjs            (exit 1 only if cases/fixtures are invalid)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const OUTCOMES = {
  "merchant-offer": [undefined],
  evidence: ["aggregator", "editorial", "not-a-listing", "merchant-no-price", "merchant-mismatch"],
  rejected: ["irrelevant-product", "unsupported-currency", "url-not-from-run", "invalid-url"],
};
const fixtureCache = new Map();
const fixture = (id) => {
  if (!fixtureCache.has(id)) {
    const p = `evals/fixtures/exa-live/${id}.json`;
    fixtureCache.set(id, existsSync(join(root, p)) ? read(p) : null);
  }
  return fixtureCache.get(id);
};

// EV-001 / EV-002 cases
const oc = read("evals/cases/offer-classification.json");
const ids = new Set();
for (const c of oc.cases) {
  check(!ids.has(c.id), `offer-classification: duplicate id ${c.id}`); ids.add(c.id);
  check(oc.candidates[c.candidate], `${c.id}: unknown candidate ${c.candidate}`);
  const e = c.expected ?? {};
  check(e.outcome in OUTCOMES, `${c.id}: unknown outcome ${e.outcome}`);
  if (e.outcome in OUTCOMES) check(OUTCOMES[e.outcome].includes(e.category), `${c.id}: category ${e.category} invalid for ${e.outcome}`);
  if (e.outcome === "merchant-offer") check(["USD", "SGD", "JPY"].includes(e.currency) && e.amount > 0, `${c.id}: offer needs supported currency and positive amount`);
  check(typeof c.rationale === "string" && c.rationale.length > 10, `${c.id}: rationale required`);
  if (c.fixture) {
    const f = fixture(c.fixture);
    check(f, `${c.id}: missing fixture ${c.fixture}`);
    const r = f?.response?.results?.[c.resultIndex];
    check(r?.url, `${c.id}: ${c.fixture} has no result ${c.resultIndex}`);
    check(f?._label?.startsWith("LIVE EXA RESPONSE"), `${c.id}: fixture ${c.fixture} is not labeled as a live response`);
    if (r && e.outcome === "merchant-offer") {
      let s; try { s = JSON.parse(r.summary); } catch { s = null; }
      check(s && s.price === e.amount, `${c.id}: expected amount ${e.amount} differs from fixture price ${s?.price}`);
    }
  } else {
    check(c.synthetic?.url && c.synthetic?.summary, `${c.id}: synthetic case needs url and summary`);
  }
}
const live = oc.cases.filter((c) => c.fixture).length;
check(live >= 40, `offer-classification: expected at least 40 live cases, found ${live}`);

// EV-003 cases
const rc = read("evals/cases/ranking-currency.json");
for (const c of rc.cases) {
  const offerIds = new Set(c.offers.map((o) => o.id));
  for (const g of c.expectedGroups) for (const id of g.order) check(offerIds.has(id), `${c.id}: unknown offer ${id}`);
  for (const o of c.offers) check(["USD", "SGD", "JPY"].includes(o.currency), `${c.id}/${o.id}: unsupported currency`);
}

// EV-004 cases
const cc = read("evals/cases/citations.json");
for (const c of cc.cases) {
  if (c.fixture) check(fixture(c.fixture)?.response?.citations?.length > 0, `${c.id}: fixture ${c.fixture} has no citations`);
  else check(typeof c.synthetic?.text === "string" && Array.isArray(c.synthetic?.citations), `${c.id}: synthetic text/citations required`);
}

// EV-008 query set
const la = read("evals/cases/live-acceptance.json");
check(la.queries.length === 6, "live-acceptance: expected 6 queries");
for (const m of ["US", "SG", "JP"]) check(la.queries.filter((q) => q.market === m).length === 2, `live-acceptance: expected 2 ${m} queries`);
check(la.budget.maxRequestsPerQuery <= 5, "live-acceptance: per-query cap must be <= 5 (D-017)");

// Fixture hygiene: no key-like strings in any fixture.
for (const f of fixtureCache.values()) {
  const s = JSON.stringify(f ?? {});
  check(!/EXA_API_KEY|x-api-key|authorization/i.test(s), `fixture ${f?.id}: contains credential-like text`);
}

// Per-evaluation readiness. Paths are the test files tasks must create (see .futari/plan.json).
const evals = [
  ["EV-001", "Merchant authenticity", "tests/evals/ev-001-merchant-authenticity.test.ts", "src/core/offers.ts"],
  ["EV-002", "Product relevance", "tests/evals/ev-002-product-relevance.test.ts", "src/core/identity.ts"],
  ["EV-003", "Currency and ranking", "tests/evals/ev-003-ranking-currency.test.ts", "src/core/rank.ts"],
  ["EV-004", "Citations", "tests/evals/ev-004-citations.test.ts", "src/core/citations.ts"],
  ["EV-005", "Spend guard and cache", "tests/evals/ev-005-spend-guard.test.ts", "src/exa/budget.ts"],
  ["EV-006", "Streaming and failure states", "tests/evals/ev-006-stream-failures.test.ts", "src/server/app.ts"],
  ["EV-007", "Frontend quality", "tests/e2e/ev-007-frontend.spec.ts", "src/web/main.tsx"],
  ["EV-008", "Live acceptance", "scripts/live-acceptance.ts", "src/research/pipeline.ts"],
  ["EV-009", "Local and key safety", "tests/evals/ev-009-key-safety.test.ts", "src/server/index.ts"],
];

console.log(errors.length ? `HARNESS INVALID (${errors.length} problems)` : `HARNESS OK: ${oc.cases.length} classification cases (${live} live), ${rc.cases.length} ranking cases, ${cc.cases.length} citation cases, ${la.queries.length} live queries.`);
for (const e of errors) console.log(`  - ${e}`);
for (const [id, name, test, product] of evals) {
  const state = !existsSync(join(root, product)) ? `NOT RUNNABLE (product module ${product} does not exist)`
    : !existsSync(join(root, test)) ? `NOT RUNNABLE (test ${test} does not exist)`
    : `READY (run the command listed for ${id} in .futari/plan.json)`;
  console.log(`${id} ${name}: ${state}`);
}
process.exitCode = errors.length ? 1 : 0;
