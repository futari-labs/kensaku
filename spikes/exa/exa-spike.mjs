#!/usr/bin/env node
// Pre-approval Exa schema spike (D-009). Hard cap: 20 live requests across all runs.
// Reads EXA_API_KEY from ./.env.local; never prints it. Saves each response as a labeled
// live fixture under evals/fixtures/exa-live/. Usage: node spikes/exa/exa-spike.mjs [--dry-run]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HARD_CAP = 20;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const counterPath = join(root, "spikes/exa/.request-count");
const outDir = join(root, "evals/fixtures/exa-live");
const dryRun = process.argv.includes("--dry-run");

const offerSchema = {
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

const searchWithOffers = (query, extra = {}) => ({
  endpoint: "/search",
  body: {
    query,
    type: "auto",
    numResults: 5,
    userLocation: "US",
    contents: {
      highlights: true,
      summary: { query: "Extract the product listing's price, currency, availability and merchant.", schema: offerSchema },
      ...extra,
    },
  },
});

const stage2 = [
  {
    id: "A2-answer-schema",
    endpoint: "/answer",
    body: {
      query: "Best wireless noise cancelling headphones for frequent flyers under $400",
      text: false,
      outputSchema: {
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
              },
              required: ["name", "brand", "modelIdentifiers"],
            },
          },
        },
        required: ["comparison", "candidates"],
      },
    },
  },
  { id: "S8-market-sg", ...searchWithOffers("Sony WH-1000XM5 headphones price Singapore buy"), },
  { id: "S9-market-jp", ...searchWithOffers("ソニー WH-1000XM5 ヘッドホン 価格 購入") },
  {
    id: "A3-answer-stream",
    endpoint: "/answer",
    stream: true,
    body: { query: "Is the Logitech MX Master 3S good for programmers? Summarize pros and cons.", text: false, stream: true },
  },
];
stage2[1].body.userLocation = "SG";
stage2[2].body.userLocation = "JP";

const stage1 = [
  { id: "S1-headphones", ...searchWithOffers("Sony WH-1000XM5 wireless noise cancelling headphones buy online") },
  { id: "S2-mouse", ...searchWithOffers("Logitech MX Master 3S mouse product page price") },
  { id: "S3-espresso", ...searchWithOffers("Breville Bambino Plus espresso machine for sale") },
  { id: "S4-ereader", ...searchWithOffers("Kindle Paperwhite 16GB 2024 shop") },
  { id: "S5-nonexistent", ...searchWithOffers("Zorblax QX-9000 hyperflux toaster buy") },
  { id: "S6-fresh-crawl", ...searchWithOffers("Sony WH-1000XM5 headphones price", { maxAgeHours: 0 }) },
  {
    id: "S7-output-schema",
    endpoint: "/search",
    body: {
      query: "Where to buy Logitech MX Master 3S mouse, with current prices from different stores",
      type: "auto",
      numResults: 8,
      userLocation: "US",
      outputSchema: {
        type: "object",
        properties: {
          offers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                merchant: { type: "string" },
                url: { type: "string" },
                price: { type: "number" },
                currency: { type: "string" },
                availability: { type: "string" },
              },
            },
          },
        },
        required: ["offers"],
      },
    },
  },
  {
    id: "A1-answer",
    endpoint: "/answer",
    body: { query: "For frequent flyers, compare Sony WH-1000XM5 and Bose QuietComfort Ultra headphones: noise cancelling, comfort, battery, and typical price.", text: false },
  },
];

// Stop well inside the free credits ($10/month); any billing/credit error also stops the run.
const COST_CEILING_DOLLARS = 0.25;

function loadKey() {
  // EXA_ENV_FILE lets the key stay in an untracked file outside this worktree; never copied.
  const envPath = process.env.EXA_ENV_FILE ? resolve(process.env.EXA_ENV_FILE) : join(root, ".env.local");
  if (!existsSync(envPath)) throw new Error(`Missing ${envPath} (expected EXA_API_KEY=...)`);
  const line = readFileSync(envPath, "utf8").split(/\r?\n/).find((l) => l.startsWith("EXA_API_KEY="));
  const key = line?.slice("EXA_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!key) throw new Error("EXA_API_KEY is empty in .env.local");
  return key;
}

const plan = process.argv.includes("--stage2") ? stage2 : stage1;
const used = existsSync(counterPath) ? Number(readFileSync(counterPath, "utf8").trim()) || 0 : 0;
if (used + plan.length > HARD_CAP) {
  console.error(`Refusing: ${used} requests already used; this run needs ${plan.length}; hard cap is ${HARD_CAP}.`);
  process.exit(2);
}
console.log(`Plan: ${plan.length} requests (${used} used so far, cap ${HARD_CAP}).`);
if (dryRun) {
  for (const p of plan) console.log(`  ${p.id} POST ${p.endpoint}`);
  process.exit(0);
}

const key = loadKey();
mkdirSync(outDir, { recursive: true });
let count = used;
let totalCost = 0;
for (const p of plan) {
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
  if (p.stream) {
    // SSE: keep every parsed `data:` event so the stream shape is recorded exactly.
    const events = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
      .filter((d) => d && d !== "[DONE]").map((d) => { try { return JSON.parse(d); } catch { return { raw: d }; } });
    body = { sseEventCount: events.length, sseEvents: events, contentType: res.headers.get("content-type") };
    body.costDollars = events.findLast?.((e) => e.costDollars)?.costDollars;
  } else {
    try { body = JSON.parse(text); } catch { body = { nonJsonBody: text.slice(0, 20000) }; }
  }
  const cost = body?.costDollars?.total ?? 0;
  totalCost += cost;
  const fixture = {
    _label: "LIVE EXA RESPONSE captured by the pre-approval spike (D-009). Real data, not a gold label.",
    id: p.id,
    request: { endpoint: p.endpoint, body: p.body },
    requestedAt,
    receivedAt,
    httpStatus: res.status,
    response: body,
  };
  writeFileSync(join(outDir, `${p.id}.json`), JSON.stringify(fixture, null, 2) + "\n");
  console.log(`${p.id}: HTTP ${res.status}, results=${body?.results?.length ?? "-"}, cost=$${cost}`);
  const billingSignal = /credit|billing|payment|quota|insufficient/i.test(text.slice(0, 4000)) && res.status >= 400;
  if (res.status === 401 || res.status === 402 || res.status === 429 || billingSignal) {
    console.error(`Stopping after ${p.id}: HTTP ${res.status}${billingSignal ? " (billing/credit signal)" : ""}.`);
    break;
  }
  if (totalCost > COST_CEILING_DOLLARS) {
    console.error(`Stopping: reported cost $${totalCost.toFixed(4)} exceeds spike ceiling $${COST_CEILING_DOLLARS}.`);
    break;
  }
}
console.log(`Done. Requests used: ${count}/${HARD_CAP}. Reported cost: $${totalCost.toFixed(4)} (free credits).`);
