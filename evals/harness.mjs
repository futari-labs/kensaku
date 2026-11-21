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
//        node evals/harness.mjs --strict   (also exit 1 while EV-004 does not load the CR-001 spaced cases,
//                                           or EV-001 does not apply the kensaku-v1-1 supersessions)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const errors = [];
const STRICT = process.argv.includes("--strict");
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const OUTCOMES = {
  "merchant-offer": [undefined],
  evidence: ["aggregator", "editorial", "not-a-listing", "merchant-no-price", "merchant-mismatch"],
  rejected: ["irrelevant-product", "unsupported-currency", "url-not-from-run", "invalid-url"],
};
// kensaku-v1-1 adds two evidence categories (ARCHITECTURE rules 5a and 5b).
const OUTCOMES_V11 = { ...OUTCOMES, evidence: [...OUTCOMES.evidence, "marketplace", "search-or-category"] };
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
// EV-004 spaced-marker cases (CR-001, D-026)
const sc = read("evals/cases/citations-spaced.json");
for (const c of sc.cases) {
  if (c.fixture) check(fixture(c.fixture)?.response?.citations?.length > 0, `${c.id}: fixture ${c.fixture} has no citations`);
  else check(typeof c.synthetic?.text === "string" && Array.isArray(c.synthetic?.citations), `${c.id}: synthetic text/citations required`);
}

// EV-008 query set
const la = read("evals/cases/live-acceptance.json");
check(la.queries.length === 6, "live-acceptance: expected 6 queries");
for (const m of ["US", "SG", "JP"]) check(la.queries.filter((q) => q.market === m).length === 2, `live-acceptance: expected 2 ${m} queries`);
check(la.budget.maxRequestsPerQuery <= 5, "live-acceptance: per-query cap must be <= 5 (D-017)");

// EV-011 cases (kensaku-v1-1 classification additions and supersessions)
const ocv = read("evals/cases/offer-classification-v1-1.json");
const ocvIds = new Set();
const v11Candidates = { ...oc.candidates, ...ocv.candidates };
for (const c of ocv.cases) {
  check(!ocvIds.has(c.id) && !ids.has(c.id), `offer-classification-v1-1: duplicate id ${c.id}`); ocvIds.add(c.id);
  check(v11Candidates[c.candidate], `${c.id}: unknown candidate ${c.candidate}`);
  const e = c.expected ?? {};
  check(e.outcome in OUTCOMES_V11 && OUTCOMES_V11[e.outcome]?.includes(e.category), `${c.id}: invalid outcome/category ${e.outcome}/${e.category}`);
  if (e.outcome === "merchant-offer") check(["USD", "SGD", "JPY"].includes(e.currency) && e.amount > 0, `${c.id}: offer needs supported currency and positive amount`);
  check(typeof c.rationale === "string" && c.rationale.length > 10, `${c.id}: rationale required`);
  if (c.fixture) {
    const f = fixture(c.fixture);
    check(f?._label?.startsWith("LIVE EXA RESPONSE"), `${c.id}: fixture ${c.fixture} missing or not labeled live`);
    const r = f?.response?.results?.[c.resultIndex];
    check(r?.url, `${c.id}: ${c.fixture} has no result ${c.resultIndex}`);
    if (r && e.outcome === "merchant-offer") {
      let s; try { s = JSON.parse(r.summary); } catch { s = null; }
      check(s && s.price === e.amount, `${c.id}: expected amount ${e.amount} differs from fixture price ${s?.price}`);
    }
  } else {
    check(c.synthetic?.url && c.synthetic?.summary, `${c.id}: synthetic case needs url and summary`);
  }
}
for (const [id, s] of Object.entries(ocv.supersedes ?? {})) {
  const original = oc.cases.find((c) => c.id === id);
  check(original, `supersedes: unknown MVP case ${id}`);
  check(original && JSON.stringify(original.expected) === JSON.stringify(s.was), `supersedes ${id}: 'was' must equal the frozen MVP label`);
  check(s.expected?.outcome in OUTCOMES_V11 && typeof s.rationale === "string", `supersedes ${id}: expected and rationale required`);
}
check(ocv.cases.filter((c) => c.fixture).length >= 40, "offer-classification-v1-1: expected at least 40 live cases");

// EV-012 cases (product card content)
const pc = read("evals/cases/product-content.json");
for (const c of pc.cases) {
  const f = c.fixture ? fixture(c.fixture) : null;
  const answerCandidates = c.fixture ? f?.response?.answer?.candidates : c.synthetic?.candidates;
  check(answerCandidates?.length === c.candidates.length, `${c.id}: candidate count differs from its answer`);
  for (const k of c.candidates) {
    const specs = k.expected.keySpecs;
    check(Array.isArray(specs) && specs.length <= 5 && specs.every((s) => typeof s === "string" && s.length > 0 && s.length <= 80), `${c.id}#${k.candidateIndex}: keySpecs must be at most 5 strings of 1-80 characters`);
    const urls = c.fixture ? (f?.response?.citations ?? []).map((x) => x.url) : c.synthetic.citations;
    if (k.expected.reason) for (const u of k.expected.reason.sources) check(urls.includes(u), `${c.id}#${k.candidateIndex}: source ${u} is not a citation of ${c.fixture}`);
  }
}

// EV-013 cases (product images)
const im = read("evals/cases/image-selection.json");
const URL_VERDICTS = ["ok", "invalid-url", "bad-scheme", "credentials", "svg", "deny-pattern"];
const BYTE_VERDICTS = ["ok", "too-large", "unsupported-type", "no-dimensions", "too-small", "aspect"];
for (const c of im.urlCases) check(URL_VERDICTS.includes(c.expected) && typeof c.imageUrl === "string", `${c.id}: invalid url case`);
for (const c of im.bytesCases) check(BYTE_VERDICTS.includes(c.expected), `${c.id}: invalid bytes verdict ${c.expected}`);
for (const c of im.selectionCases) {
  const results = c.fixture ? fixture(c.fixture)?.response?.results : c.synthetic?.hits;
  check(Array.isArray(results), `${c.id}: needs a fixture or synthetic hits`);
  check(v11Candidates[c.candidate] && ["US", "SG", "JP"].includes(c.market), `${c.id}: unknown candidate or market`);
  check(c.expected.length <= 4, `${c.id}: at most 4 image candidates`);
  for (const e of c.expected) {
    const r = results?.find((x) => x.url === e.pageUrl);
    check(r && r.image === e.imageUrl, `${c.id}: ${e.pageUrl} with that image is not one of its hits`);
  }
}

// EV-015 / REQ-009: real MVP history payload (review finding 14)
const mh = read("evals/fixtures/history/mvp-history-xm5-sg.json");
check(mh.key === "kensaku.history.v1" && mh._label?.startsWith("REAL kensaku.history.v1"), "mvp-history: key and label required");
let mhValue = null;
try { mhValue = JSON.parse(mh.value); } catch { /* checked below */ }
check(mhValue?.version === 1 && Array.isArray(mhValue?.messages) && mh.value.includes("data-products"), "mvp-history: value must be a version 1 history with a data-products part");

// EV-016 query set (kensaku-v1-1 live acceptance)
const lv = read("evals/cases/live-acceptance-v1-1.json");
check(lv.queries.length === 8, "live-acceptance-v1-1: expected 8 queries");
for (const [m, n] of [["US", 2], ["SG", 4], ["JP", 2]]) check(lv.queries.filter((q) => q.market === m).length === n, `live-acceptance-v1-1: expected ${n} ${m} queries`);
for (const q of la.queries) check(lv.queries.some((x) => x.id === q.id && x.market === q.market && x.text === q.text), `live-acceptance-v1-1: MVP query ${q.id} must be unchanged`);
check(lv.budget.maxRequestsPerQuery <= 5 && lv.budget.maxRequestsPerSuiteRun <= 40 && lv.budget.maxSuiteRuns <= 3 && lv.budget.maxReportedCostDollarsPerSuiteRun <= 0.5, "live-acceptance-v1-1: budget exceeds the approved caps");

// Fixture hygiene: no key-like strings in any fixture file, referenced or not (review finding 20).
for (const dir of ["evals/fixtures/exa-live", "evals/fixtures/history"]) {
  for (const name of readdirSync(join(root, dir))) {
    const s = readFileSync(join(root, dir, name), "utf8");
    check(!/EXA_API_KEY|x-api-key|authorization/i.test(s), `${dir}/${name}: contains credential-like text`);
  }
}

// Per-evaluation readiness. Paths are the test files tasks must create (see .futari/plan.json).
// The fifth column names the frozen case file a READY test must load.
const evals = [
  ["EV-001", "Merchant authenticity", "tests/evals/ev-001-merchant-authenticity.test.ts", "src/core/offers.ts", "offer-classification.json"],
  ["EV-002", "Product relevance", "tests/evals/ev-002-product-relevance.test.ts", "src/core/identity.ts", "offer-classification.json"],
  ["EV-003", "Currency and ranking", "tests/evals/ev-003-ranking-currency.test.ts", "src/core/rank.ts", "ranking-currency.json"],
  ["EV-004", "Citations", "tests/evals/ev-004-citations.test.ts", "src/core/citations.ts", "citations.json"],
  ["EV-005", "Spend guard and cache", "tests/evals/ev-005-spend-guard.test.ts", "src/exa/budget.ts"],
  ["EV-006", "Streaming and failure states", "tests/evals/ev-006-stream-failures.test.ts", "src/server/app.ts"],
  ["EV-007", "Frontend quality", "tests/e2e/ev-007-frontend.spec.ts", "src/web/main.tsx"],
  ["EV-009", "Local and key safety", "tests/evals/ev-009-key-safety.test.ts", "src/server/index.ts"],
  ["EV-010", "Theme", "tests/e2e/ev-010-theme.spec.ts", "src/web/app/theme.ts"],
  ["EV-011", "Non-merchant pages and currency symbols", "tests/evals/ev-011-page-classification.test.ts", "src/core/offers.ts", "offer-classification-v1-1.json"],
  ["EV-012", "Product card content", "tests/evals/ev-012-product-content.test.ts", "src/core/content.ts", "product-content.json"],
  ["EV-013", "Product image selection", "tests/evals/ev-013-image-selection.test.ts", "src/core/images.ts", "image-selection.json"],
  ["EV-014", "Image proxy safety and cache", "tests/evals/ev-014-image-proxy.test.ts", "src/server/images.ts"],
  ["EV-015", "Image-first product cards", "tests/e2e/ev-015-product-cards.spec.ts", "src/web/app/ProductCard.tsx"],
  ["EV-016", "Live acceptance v1.1", "scripts/live-acceptance-v1-1.ts", "src/research/pipeline.ts", "live-acceptance-v1-1.json"],
  ["EV-017", "Request contract", "tests/evals/ev-017-request-contract.test.ts", "src/exa/requests.ts"],
];

console.log(errors.length ? `HARNESS INVALID (${errors.length} problems)` : `HARNESS OK: ${oc.cases.length} classification cases (${live} live), ${rc.cases.length} ranking cases, ${cc.cases.length} citation cases (+${sc.cases.length} spaced), ${la.queries.length} MVP live queries; v1.1: ${ocv.cases.length} classification cases (+${Object.keys(ocv.supersedes ?? {}).length} supersessions), ${pc.cases.length} content cases, ${im.urlCases.length}/${im.selectionCases.length}/${im.bytesCases.length} image url/selection/bytes cases, ${lv.queries.length} live queries.`);
for (const e of errors) console.log(`  - ${e}`);
for (const [id, name, test, product, caseFile] of evals) {
  let state;
  if (!existsSync(join(root, product))) state = `NOT RUNNABLE (product module ${product} does not exist)`;
  else if (!existsSync(join(root, test))) state = `NOT RUNNABLE (test ${test} does not exist)`;
  else if (caseFile && !readFileSync(join(root, test), "utf8").includes(caseFile)) {
    state = `INVALID TEST (${test} does not load frozen evals/cases/${caseFile})`;
    errors.push(`${id}: ${test} must load evals/cases/${caseFile}`);
  } else if (id === "EV-004" && !readFileSync(join(root, test), "utf8").includes("citations-spaced.json")) {
    if (STRICT) {
      state = `INVALID TEST (${test} does not load frozen evals/cases/citations-spaced.json; CR-001)`;
      errors.push(`${id}: ${test} must load evals/cases/citations-spaced.json (CR-001)`);
    } else state = `READY (CR-001 spaced cases pending JM-006: ${test} does not load evals/cases/citations-spaced.json yet)`;
  } else if (id === "EV-001" && !readFileSync(join(root, test), "utf8").includes("offer-classification-v1-1.json")) {
    if (STRICT) {
      state = `INVALID TEST (${test} does not apply the supersessions in evals/cases/offer-classification-v1-1.json; kensaku-v1-1)`;
      errors.push(`${id}: ${test} must apply the supersessions in evals/cases/offer-classification-v1-1.json (D-031, D-032)`);
    } else state = `READY (kensaku-v1-1 supersessions L29/Y03 pending JM-101: ${test} does not load evals/cases/offer-classification-v1-1.json yet)`;
  } else state = `READY (run the command listed for ${id} in .futari/plan.json)`;
  console.log(`${id} ${name}: ${state}`);
}
if (errors.length) console.log(`HARNESS INVALID after test checks (${errors.length} problems)`);
process.exitCode = errors.length ? 1 : 0;
