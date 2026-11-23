#!/usr/bin/env node
// Kensaku evaluation harness (pre-implementation). Node >= 22, no dependencies.
//
// It reports three distinct states per evaluation and never conflates them:
//   HARNESS OK      the frozen cases and fixtures are internally valid
//   NOT RUNNABLE    the product code or test file the evaluation needs does not exist yet
//   READY           the evaluation's test file exists; run its listed command to get PASS/FAIL
// It does not run product tests and never reports a product PASS.
//
// kensaku-v1-2 adds structural checks for the commerce case files (EV-018 to EV-020, EV-023).
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

for (const k of pc.comparisonCases ?? []) {
  const f = fixture(k.fixture);
  check(f?._label?.startsWith("LIVE EXA RESPONSE") && f?.response?.citations?.length > 0, `${k.id}: fixture ${k.fixture} missing, unlabeled, or without citations`);
  const urls = (f?.response?.citations ?? []).map((x) => x.url);
  if (k.expected) {
    check(!/[{}]/.test(k.expected.renderedText), `${k.id}: rendered comparison still contains leaked structure`);
    for (const u of k.expected.sources) check(urls.includes(u), `${k.id}: source ${u} is not a citation of ${k.fixture}`);
  }
}
check((pc.comparisonCases ?? []).some((k) => k.expected?.truncated), "product-content: needs at least one truncated comparison case");

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

// kensaku-v1-2: EV-018 cart and demo price rules (reference checks of the written rules, not product code)
const { createHash } = await import("node:crypto");
const cr = read("evals/cases/commerce-rules.json");
const offerIdOf = (o) => createHash("sha256").update([o.canonicalUrl, o.price.currency, String(o.price.amount), o.exaRequestId, o.retrievedAt].join("\n"), "utf8").digest("hex");
const minorOf = (amount, currency) => {
  if (!Number.isFinite(amount) || amount <= 0) return "invalid";
  if (currency === "JPY") return Number.isInteger(amount) ? amount : "invalid";
  if (currency !== "USD" && currency !== "SGD") return "invalid";
  const scaled = amount * 100, rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : "invalid";
};
check(cr._label?.startsWith("SYNTHETIC CASES"), "commerce-rules: synthetic label required");
for (const [key, o] of Object.entries(cr.offers)) {
  if (o.id) check(o.id === offerIdOf(o), `commerce-rules: offer ${key} id does not match the offerId rule`);
  check(["in_stock", "out_of_stock", "preorder", "unknown"].includes(o.availability), `commerce-rules: offer ${key} availability`);
}
for (const k of cr.registered) check(cr.offers[k], `commerce-rules: registered offer ${k} undefined`);
check(/^0{64}$/.test(cr.unregisteredOfferId), "commerce-rules: unregisteredOfferId must be 64 zeros");
for (const c of cr.offerIdCases) check(cr.offers[c.offer]?.id, `${c.id}: offer needs a precomputed id`);
for (const c of cr.minorUnitCases) check(minorOf(c.amount, c.currency) === c.expected, `${c.id}: expected ${c.expected}, rule gives ${minorOf(c.amount, c.currency)}`);
const CART_CODES = ["invalid-request", "quantity-out-of-range", "offer-not-registered", "out-of-stock", "below-minimum", "currency-mismatch", "quantity-limit", "line-limit", "total-too-large", "not-in-cart"];
const cartIds = new Set();
for (const c of cr.cartCases) {
  check(!cartIds.has(c.id), `commerce-rules: duplicate ${c.id}`); cartIds.add(c.id);
  for (const l of c.start ?? []) check(cr.offers[l.offer], `${c.id}: unknown start offer ${l.offer}`);
  if (c.op.offer) check(cr.offers[c.op.offer], `${c.id}: unknown op offer ${c.op.offer}`);
  check(c.expected.outcome === "ok" || CART_CODES.includes(c.expected.code), `${c.id}: unknown error code ${c.expected.code}`);
  const cart = c.expected.cart;
  if (cart) {
    let total = 0;
    for (const l of cart.lines) {
      const o = cr.offers[l.offer];
      check(o && minorOf(o.price.amount, o.price.currency) === l.demoUnitAmountMinor, `${c.id}: demoUnitAmountMinor for ${l.offer} breaks the minorUnits rule`);
      check(o && o.price.currency === cart.currency, `${c.id}: line ${l.offer} currency differs from cart currency`);
      check(l.quantity >= 1 && l.quantity <= 10, `${c.id}: quantity out of range in expected cart`);
      total += l.demoUnitAmountMinor * l.quantity;
    }
    check(total === cart.totalMinor, `${c.id}: totalMinor ${cart.totalMinor} != ${total}`);
    check(cart.lines.length > 0 || cart.currency === null, `${c.id}: empty cart must have currency null`);
  }
}
for (const c of cr.snapshotCases) {
  const o = cr.offers[c.offer];
  check(o && c.expectedLine.observed.amount === o.price.amount && c.expectedLine.observed.merchantHost === o.merchantHost && c.expectedLine.observed.retrievedAt === o.retrievedAt, `${c.id}: snapshot must copy the registry`);
  check(o && minorOf(o.price.amount, o.price.currency) === c.expectedLine.demoUnitAmountMinor, `${c.id}: demo price must be the observed price in minor units`);
}

// kensaku-v1-2: EV-019 checkout session request
const csr = read("evals/cases/checkout-session-request.json");
for (const c of csr.cases) {
  const { port, now, order } = c.input, p = c.expected.params, cur = order.currency.toLowerCase();
  check(p.mode === "payment" && p.currency === cur && p.adaptive_pricing?.enabled === false, `${c.id}: fixed fields`);
  check(!("payment_method_types" in p), `${c.id}: payment_method_types is not allowed (stripe 23)`);
  check(p.expires_at === Math.floor(Date.parse(now) / 1000) + 1800, `${c.id}: expires_at rule`);
  check(p.client_reference_id === order.orderId && p.metadata?.kensaku_order_id === order.orderId && p.metadata?.kensaku_simulated === "true" && p.payment_intent_data?.metadata?.kensaku_order_id === order.orderId, `${c.id}: order references`);
  check(p.success_url === `http://127.0.0.1:${port}/?checkout=success&order=${order.orderId}&session_id={CHECKOUT_SESSION_ID}` && p.cancel_url === `http://127.0.0.1:${port}/?checkout=cancelled&order=${order.orderId}`, `${c.id}: urls rule`);
  check(c.expected.options?.idempotencyKey === `kensaku-order-${order.orderId}`, `${c.id}: idempotency key rule`);
  check(p.line_items.length === order.lines.length, `${c.id}: one line item per order line`);
  order.lines.forEach((l, i) => {
    const li = p.line_items[i], name = [...l.productName.trim()].slice(0, 120).join("").trimEnd();
    check(li.quantity === l.quantity && li.price_data.currency === cur && li.price_data.unit_amount === l.demoUnitAmountMinor, `${c.id}: line ${i} amounts`);
    check(li.price_data.product_data.name === `Simulated: ${name}`, `${c.id}: line ${i} name rule`);
    check(li.price_data.product_data.description === `Simulated Kensaku purchase in a Stripe sandbox. No order is placed with ${l.merchantHost} and no real payment is taken. Demo price copied from the price last observed on ${l.merchantHost} at ${l.observed.retrievedAt}.`, `${c.id}: line ${i} description rule`);
  });
}

// kensaku-v1-2: EV-020 webhooks and order state
const we = read("evals/cases/webhook-events.json");
const OUTCOMES_W = { 200: ["applied", "duplicate", "ignored-type", "unknown-order", "mismatch", "no-transition"], 400: ["rejected-signature", "invalid-payload", "rejected-livemode"] };
const STATES = ["open", "paid", "cancelled", "expired", "payment_failed", "failed"];
for (const c of we.webhookCases) {
  for (const d of c.deliveries) {
    check(d.rawBody !== undefined || we.templates[d.template], `${c.id}: unknown template ${d.template}`);
    check(["valid", "wrong-secret", "stale", "missing", "tampered"].includes(d.signature), `${c.id}: unknown signature mode`);
    check(OUTCOMES_W[d.expect.status]?.includes(d.expect.outcome), `${c.id}: outcome ${d.expect.outcome} invalid for status ${d.expect.status}`);
    if (d.signature !== "valid") check(d.expect.status === 400, `${c.id}: a bad signature must be 400`);
  }
  check(STATES.includes(c.final.state), `${c.id}: unknown final state`);
  if (!c.deliveries.some((d) => d.expect.outcome === "applied" && ["completed", "asyncSucceeded"].includes(d.template) && !d.override?.["object.payment_status"])) check(c.final.state !== "paid", `${c.id}: paid without a verified paid event`);
}
for (const c of we.routeCases) check(c.steps.length > 0, `${c.id}: steps required`);

// kensaku-v1-2: EV-023 live sandbox acceptance
const l2 = read("evals/cases/live-acceptance-v1-2.json");
for (const q of l2.queries) check(lv.queries.some((x) => x.id === q.id && x.market === q.market && x.text === q.text), `live-acceptance-v1-2: ${q.id} must reuse the v1.1 query verbatim`);
check(l2.budget.exa.planWideMaxRequests <= 30 && l2.budget.exa.planWideMaxCostDollars <= 0.4 && l2.budget.exa.smokeMaxRequests + l2.budget.exa.ev023MaxRequests <= l2.budget.exa.planWideMaxRequests, "live-acceptance-v1-2: Exa budget exceeds the approved caps (D-051)");
check(l2.budget.stripe.maxSpend === 0 && l2.budget.stripe.liveKeysAllowed === false, "live-acceptance-v1-2: Stripe must be sandbox only");
check(l2.scenarios.map((s) => s.id).join() === "A1,A2,A3,A4,A5,A6,A7,A8", "live-acceptance-v1-2: scenarios A1-A8 required");

// Stripe secret hygiene in the v1.2 frozen inputs
for (const name of ["commerce-rules.json", "checkout-session-request.json", "webhook-events.json", "live-acceptance-v1-2.json"]) {
  const s = readFileSync(join(root, "evals/cases", name), "utf8");
  check(!/(sk|rk|rkcs|pk)_(test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/.test(s), `evals/cases/${name}: contains a Stripe key-like string`);
}

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
  ["EV-016", "Live acceptance v1.1 (historical, kensaku-v1-1)", "scripts/live-acceptance-v1-1.ts", "src/research/pipeline.ts", "live-acceptance-v1-1.json"],
  ["EV-017", "Request contract", "tests/evals/ev-017-request-contract.test.ts", "src/exa/requests.ts"],
  // kensaku-v1-2
  ["EV-018", "Cart and demo price rules", "tests/evals/ev-018-commerce-rules.test.ts", "src/core/commerce.ts", "commerce-rules.json"],
  ["EV-019", "Checkout session request", "tests/evals/ev-019-checkout-request.test.ts", "src/commerce/session-request.ts", "checkout-session-request.json"],
  ["EV-020", "Webhooks and order state", "tests/evals/ev-020-webhooks.test.ts", "src/commerce/webhook.ts", "webhook-events.json"],
  ["EV-021", "Sandbox-only Stripe keys", "tests/evals/ev-021-stripe-keys.test.ts", "src/commerce/stripe-port.ts"],
  ["EV-022", "Simulated commerce UI", "tests/e2e/ev-022-commerce.spec.ts", "src/web/app/Cart.tsx"],
  ["EV-023", "Live sandbox acceptance", "scripts/live-acceptance-v1-2.ts", "src/commerce/service.ts", "live-acceptance-v1-2.json"],
];

console.log(errors.length ? `HARNESS INVALID (${errors.length} problems)` : `HARNESS OK: ${oc.cases.length} classification cases (${live} live), ${rc.cases.length} ranking cases, ${cc.cases.length} citation cases (+${sc.cases.length} spaced), ${la.queries.length} MVP live queries; v1.1: ${ocv.cases.length} classification cases (+${Object.keys(ocv.supersedes ?? {}).length} supersessions), ${pc.cases.length} content cases, ${im.urlCases.length}/${im.selectionCases.length}/${im.bytesCases.length} image url/selection/bytes cases, ${lv.queries.length} live queries; v1.2: ${cr.cartCases.length} cart, ${cr.minorUnitCases.length} minor-unit, ${csr.cases.length} session-request, ${we.webhookCases.length} webhook and ${we.routeCases.length} route cases, ${l2.scenarios.length} live sandbox scenarios.`);
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
