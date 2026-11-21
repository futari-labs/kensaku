#!/usr/bin/env node
// Pre-approval Exa spike for plan kensaku-v1-1 (owner approval 2026-11-21, D-028).
// Hard cap: 10 live requests across all runs, persisted before each call. Questions:
//   1. Does a market-aware offer query ("<brand> <name> price <Market> buy") return local
//      merchants and currency for SG, without hurting US and JP?
//   2. Does an extended /answer outputSchema return per-candidate key specs and a cited reason?
//   3. How often does Exa's `image` field point at a usable product image?
// Reads EXA_API_KEY from EXA_ENV_FILE (never printed, never copied). Saves each response as a
// labeled live fixture under spikes/exa-v1-1/out/. Usage: node spikes/exa-v1-1/spike.mjs [--dry-run] [--followup]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HARD_CAP = 10;
const COST_CEILING_DOLLARS = 0.2;
const here = dirname(fileURLToPath(import.meta.url));
const counterPath = join(here, ".request-count");
const outDir = join(here, "out");
const dryRun = process.argv.includes("--dry-run");

// Copied verbatim from src/exa/requests.ts at dev a3a2894 so only the query template varies.
const OFFER_SUMMARY_QUERY = "Extract the product listing's price, currency, availability and merchant.";
const OFFER_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    isProductListing: { type: "boolean", description: "True only if this page sells one specific product." },
    productName: { type: "string" },
    merchant: { type: "string", description: "Store or seller name shown on the page." },
    price: { type: "number", description: "Current listed price as a number, no symbols. Omit if not shown." },
    currency: { type: "string", description: "ISO 4217 code such as USD. Omit if not shown." },
    availability: { type: "string", enum: ["in_stock", "out_of_stock", "preorder", "unknown"] },
  },
  required: ["isProductListing"],
};
const MARKET_NAME = { US: "United States", SG: "Singapore", JP: "Japan" };

// Candidate under test: production schema plus keySpecs and reason.
const EXTENDED_ANSWER_SCHEMA = {
  type: "object",
  properties: {
    comparison: { type: "string", description: "Short comparison with numbered citation markers like [1]." },
    candidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          brand: { type: "string" },
          modelIdentifiers: { type: "array", items: { type: "string" }, description: "Model numbers or distinctive tokens." },
          keySpecs: { type: "array", maxItems: 5, items: { type: "string" }, description: "Up to 5 short key specifications, each under 60 characters." },
          reason: { type: "string", description: "One or two sentences on why this product fits the question, with numbered citation markers like [1]." },
        },
        required: ["name", "brand", "modelIdentifiers", "keySpecs", "reason"],
      },
    },
  },
  required: ["comparison", "candidates"],
};

const search = (id, brand, name, market) => ({
  id,
  endpoint: "/search",
  body: {
    query: `${brand} ${name} price ${MARKET_NAME[market]} buy`,
    type: "auto",
    numResults: 8,
    userLocation: market,
    contents: { highlights: true, summary: { query: OFFER_SUMMARY_QUERY, schema: OFFER_SUMMARY_SCHEMA } },
  },
});

// Candidates for V2-V6 are the ones Exa produced in EV-008 run 1 (Q3, Q4, Q1, Q6), so the
// only change from run 1 is the query template.
const fixed = [
  {
    id: "V1-answer-sg-extended",
    endpoint: "/answer",
    body: { query: "Best noise cancelling headphones under S$400 in Singapore", text: false, outputSchema: EXTENDED_ANSWER_SCHEMA, userLocation: "SG" },
  },
  search("V2-search-sg-xm5", "Sony", "WH-1000XM5 Wireless Noise Cancelling Headphones", "SG"),
  search("V3-search-sg-bambino", "Breville", "Bambino Plus", "SG"),
  search("V4-search-us-xm5-control", "Sony", "WH-1000XM5 Premium Wireless Noise Cancelling Headphones", "US"),
  search("V5-search-jp-kindle", "Amazon", "Kindle Paperwhite (2024年モデル)", "JP"),
];
const DYNAMIC_SEARCHES = 2; // V6, V7: first two candidates of V1, as the pipeline would do.

// Run 2 (--followup, 1 request): V1's reasons quoted prices; test a "no prices" instruction.
const NO_PRICE_SCHEMA = structuredClone(EXTENDED_ANSWER_SCHEMA);
NO_PRICE_SCHEMA.properties.candidates.items.properties.reason.description =
  "One or two sentences on why this product fits the question, with numbered citation markers like [1]. Do not mention prices or currency amounts.";
const followup = [
  { id: "V8-answer-us-no-price-reason", endpoint: "/answer", body: { query: "Best ergonomic wireless mouse for programming under $120", text: false, outputSchema: NO_PRICE_SCHEMA, userLocation: "US" } },
];
const isFollowup = process.argv.includes("--followup");

function loadKey() {
  const envPath = process.env.EXA_ENV_FILE ? resolve(process.env.EXA_ENV_FILE) : "";
  if (!envPath || !existsSync(envPath)) throw new Error("Set EXA_ENV_FILE to the untracked .env.local holding EXA_API_KEY");
  const line = readFileSync(envPath, "utf8").split(/\r?\n/).find((l) => l.startsWith("EXA_API_KEY="));
  const key = line?.slice("EXA_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!key) throw new Error("EXA_API_KEY is empty");
  return key;
}

const used = existsSync(counterPath) ? Number(readFileSync(counterPath, "utf8").trim()) || 0 : 0;
const needed = isFollowup ? followup.length : fixed.length + DYNAMIC_SEARCHES;
if (used + needed > HARD_CAP) {
  console.error(`Refusing: ${used} used; this run needs up to ${needed}; hard cap ${HARD_CAP}.`);
  process.exit(2);
}
console.log(`Plan: up to ${needed} requests (${used} used so far, cap ${HARD_CAP}).`);
if (dryRun) {
  for (const p of fixed) console.log(`  ${p.id} POST ${p.endpoint} ${JSON.stringify(p.body.query)}`);
  console.log(`  + ${DYNAMIC_SEARCHES} searches for V1's first candidates`);
  process.exit(0);
}

const key = loadKey();
mkdirSync(outDir, { recursive: true });
let count = used;
let totalCost = 0;
let stop = false;

async function call(p) {
  if (count >= HARD_CAP) throw new Error("hard cap reached");
  count += 1;
  writeFileSync(counterPath, String(count)); // persist before the call so a crash still counts it
  const requestedAt = new Date().toISOString();
  const res = await fetch(`https://api.exa.ai${p.endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(p.body),
  });
  const receivedAt = new Date().toISOString();
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { nonJsonBody: text.slice(0, 20000) }; }
  const cost = body?.costDollars?.total ?? 0;
  totalCost += cost;
  const fixture = {
    _label: "LIVE EXA RESPONSE captured by the kensaku-v1-1 pre-approval spike. Real data, not a gold label.",
    id: p.id,
    request: { endpoint: p.endpoint, body: p.body },
    requestedAt,
    receivedAt,
    httpStatus: res.status,
    response: body,
  };
  if (text.includes(key)) throw new Error("response unexpectedly contains the key; not saving");
  writeFileSync(join(outDir, `${p.id}.json`), JSON.stringify(fixture, null, 2) + "\n");
  console.log(`${p.id}: HTTP ${res.status}, results=${body?.results?.length ?? "-"}, cost=$${cost}`);
  const billingSignal = res.status >= 400 && /credit|billing|payment|quota|insufficient/i.test(text.slice(0, 4000));
  if ([401, 402, 429].includes(res.status) || billingSignal || totalCost > COST_CEILING_DOLLARS) stop = true;
  return body;
}

if (isFollowup) {
  for (const p of followup) await call(p);
  console.log(`Done. Requests used: ${count}/${HARD_CAP}. Reported cost: $${totalCost.toFixed(4)} (free credits).`);
  process.exit(0);
}
let answer;
for (const p of fixed) {
  if (stop) break;
  const body = await call(p);
  if (p.id.startsWith("V1")) answer = body;
}
const candidates = (answer?.answer?.candidates ?? []).slice(0, DYNAMIC_SEARCHES);
for (const [i, c] of candidates.entries()) {
  if (stop) break;
  await call(search(`V${6 + i}-search-sg-candidate-${i + 1}`, c.brand, c.name, "SG"));
}
console.log(`Done. Requests used: ${count}/${HARD_CAP}. Reported cost: $${totalCost.toFixed(4)} (free credits).`);
