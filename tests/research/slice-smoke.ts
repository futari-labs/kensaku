// The JM-104 slice smoke (EVALUATION_PLAN, "Slice smoke (JM-104)"): Q3 and Q4 of the v1.1 set through the real
// app in live mode, then every product's image candidates through /api/image/:id. Writes one log per query to
// .futari/evidence/live/jm-104-smoke-<Q>.json.
//
//   pnpm build
//   EXA_ENV_FILE=/path/to/.env.local pnpm exec tsx tests/research/slice-smoke.ts Q3 Q4
//
// The server runs in a new empty directory (empty Exa cache, empty image cache) with a monthly limit of 10
// requests, so the total cannot pass 10. A query starts only if its worst case (5 requests) still fits.
// The key is read only to check that no output holds its first 8 characters; it is never printed or written.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sniffImage } from "../../src/core";
import { executeQuery, loadQueries, PORT, startSmokeServer, writeEvidence } from "./live-run";
import type { SmokeSession } from "./live-run";

const BUDGET = 10;
const WORST_CASE_PER_QUERY = 5;

const ids = process.argv.slice(2);
const envFile = process.env.EXA_ENV_FILE;
if (!envFile || ids.length === 0) throw new Error("usage: EXA_ENV_FILE=<path> tsx tests/research/slice-smoke.ts Q3 [Q4 ...]");
const queries = loadQueries(ids, "live-acceptance-v1-1.json");

interface ImageProbe {
  id: string;
  sourceHost: string;
  sourceTitle: string;
  /** From the proxy's registry entry on disk: what the server fetched. */
  imageUrl: string | null;
  pageUrl: string | null;
  /** 0 when the request itself failed (see `error`). */
  status: number;
  error?: string;
  contentType: string | null;
  sniffed: { type: string; width: number; height: number } | null;
  bytes: number;
}

/** Loads one candidate the way the page does: a same-origin GET to the proxy. */
async function probe(session: SmokeSession, candidate: { id: string; sourceHost: string; sourceTitle: string }): Promise<ImageProbe> {
  const registry = join(dirname(session.exchangesPath), ".cache/images", `${candidate.id}.json`);
  const entry = existsSync(registry) ? (JSON.parse(readFileSync(registry, "utf8")) as { url?: string; pageUrl?: string }) : {};
  const known = { ...candidate, imageUrl: entry.url ?? null, pageUrl: entry.pageUrl ?? null };
  let res: Response;
  let bytes: Uint8Array;
  try {
    res = await fetch(`http://127.0.0.1:${PORT}/api/image/${candidate.id}`, { headers: { "sec-fetch-site": "same-origin" }, signal: AbortSignal.timeout(30_000) });
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    return { ...known, status: 0, error: error instanceof Error ? error.name : "unknown", contentType: null, sniffed: null, bytes: 0 };
  }
  const ok = res.status === 200;
  return {
    ...known,
    status: res.status,
    contentType: res.headers.get("content-type"),
    sniffed: ok ? sniffImage(bytes) : null,
    bytes: ok ? bytes.length : 0,
  };
}

const session = await startSmokeServer(envFile, { maxRequests: BUDGET, fresh: true });
let used = 0;
const summary: string[] = [];
try {
  for (const query of queries) {
    if (used + WORST_CASE_PER_QUERY > BUDGET) {
      summary.push(`${query.id}: not run, ${BUDGET - used} requests left and the worst case is ${WORST_CASE_PER_QUERY}`);
      break;
    }
    const serverLogStart = session.server.lines.length;
    const queryLog = await executeQuery(session, query);
    used += queryLog.totals.exaRequests;

    const products = queryLog.displayed.products ?? [];
    const images = [];
    for (const product of products) {
      const probes: ImageProbe[] = [];
      for (const candidate of product.imageCandidates ?? []) probes.push(await probe(session, candidate));
      images.push({ product: `${product.candidate.brand} ${product.candidate.name}`, candidates: probes });
    }
    const offers = products.flatMap((p) => p.offerGroups.flatMap((g) => g.offers.map((o) => ({ product: `${p.candidate.brand} ${p.candidate.name}`, merchantHost: o.merchantHost, price: o.price, availability: o.availability, canonicalUrl: o.canonicalUrl }))));
    // After the probes, so the snapshot holds the image requests' log lines too.
    const log = { ...queryLog, serverLog: session.server.lines.slice(serverLogStart) };
    const loaded = images.flatMap((i) => i.candidates).filter((c) => c.status === 200);
    const sgdOffers = offers.filter((o) => o.price.currency === "SGD").length;
    const outcome = log.error ? ["credits_exhausted", "monthly_limit", "rate_limited", "upstream", "timeout"].includes((log.error as { kind?: string }).kind ?? "") ? "BLOCKED" : "FAIL" : sgdOffers > 0 && loaded.length > 0 ? "PASS" : "FAIL";

    const path = writeEvidence(session, `jm-104-smoke-${query.id}.json`, {
      task: "JM-104",
      outcome,
      ...log,
      summary: { offers: offers.length, sgdOffers, offerList: offers, imageProbes: images, imagesLoaded: loaded.length, comparisonTruncated: log.displayed.comparisonTruncated },
    });
    summary.push(`${query.id}: ${outcome}, requests ${log.totals.exaRequests}, cost ${log.totals.costDollars}, SGD offers ${sgdOffers}, images loaded ${loaded.length}, truncated ${log.displayed.comparisonTruncated}, wrote ${path}`);
    if (outcome !== "PASS") break;
  }
} finally {
  session.server.stop();
  console.log(summary.join("\n"));
  console.log(`total Exa requests: ${used}`);
}
