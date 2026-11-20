#!/usr/bin/env node
// Summarize the captured Exa spike fixtures: per-result offer fields and fill rates.
// Usage: node spikes/exa/analyze.mjs [--verbose]
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "evals/fixtures/exa-live");
const verbose = process.argv.includes("--verbose");
const parse = (s) => { if (s && typeof s === "object") return s; try { return JSON.parse(s); } catch { return null; } };

const totals = { results: 0, summaryJson: 0, listing: 0, withPrice: 0, withCurrency: 0, withMerchant: 0, withAvail: 0, snapshotAt: 0, complete: 0 };
for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
  const x = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const r = x.response;
  console.log(`\n## ${x.id}  http=${x.httpStatus}  resolved=${r.resolvedSearchType ?? "-"}  cost=${JSON.stringify(r.costDollars ?? null)}`);
  console.log(`   response keys: ${Object.keys(r).join(", ")}`);
  for (const it of r.results ?? []) {
    const s = parse(it.summary);
    const isSearchWithSummary = it.summary !== undefined;
    if (isSearchWithSummary) {
      totals.results++;
      if (s) totals.summaryJson++;
      if (s?.isProductListing) totals.listing++;
      if (typeof s?.price === "number" && s.price > 0) totals.withPrice++;
      if (typeof s?.currency === "string" && /^[A-Z]{3}$/.test(s.currency)) totals.withCurrency++;
      if (s?.merchant) totals.withMerchant++;
      if (s?.availability && s.availability !== "unknown") totals.withAvail++;
      if (it.snapshotAt) totals.snapshotAt++;
      if (typeof s?.price === "number" && s.price > 0 && /^[A-Z]{3}$/.test(s?.currency ?? "") && s?.merchant) totals.complete++;
    }
    const host = new URL(it.url).host;
    console.log(`   - ${host}  listing=${s?.isProductListing ?? "-"} price=${s?.price ?? "-"} ${s?.currency ?? ""} avail=${s?.availability ?? "-"} merchant=${s?.merchant ?? "-"} snap=${it.snapshotAt ?? "-"}${s?.productName ? `\n       product="${s.productName}"` : ""}`);
    if (verbose) {
      console.log(`     url=${it.url}`);
      console.log(`     result keys=${Object.keys(it).join(",")}`);
      console.log(`     highlights=${JSON.stringify(it.highlights ?? []).slice(0, 300)}`);
    }
  }
  if (r.output) console.log(`   OUTPUT: ${JSON.stringify(r.output).slice(0, verbose ? 4000 : 1200)}`);
  if (r.answer) {
    const a = typeof r.answer === "string" ? r.answer : JSON.stringify(r.answer);
    console.log(`   ANSWER (${a.length} chars): ${a.slice(0, verbose ? 3000 : 600)}`);
    console.log(`   CITATIONS: ${(r.citations ?? []).map((c) => new URL(c.url).host).join(", ")}`);
  }
  if (r.warnings || r.notices) console.log(`   WARNINGS/NOTICES: ${JSON.stringify({ w: r.warnings, n: r.notices })}`);
}
console.log(`\n## Totals over search results with summaries\n${JSON.stringify(totals, null, 2)}`);
