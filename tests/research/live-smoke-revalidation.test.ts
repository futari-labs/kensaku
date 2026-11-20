// Revalidation of the committed live smoke logs (.futari/evidence/live/jm-004-smoke-*.json): every
// displayed offer is reclassified from the recorded Exa response and must equal what was displayed.
// This is a self-consistency check (it detects display or pipeline mutation, not extraction errors).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyHit } from "../../src/core";
import type { Candidate, Offer } from "../../src/core/types";
import { parseAnswerResponse, parseSearchResponse } from "../../src/exa/parse";
import { frozen } from "../exa/helpers";

const DIR = join(import.meta.dirname, "../../.futari/evidence/live");

interface Product {
  candidate: Candidate;
  offerGroups: { offers: Offer[] }[];
}
export interface SmokeLog {
  queryId: string;
  finalState: string;
  exaExchanges: { endpoint: string; response: unknown }[];
  displayed: { products: Product[] | null };
}

/** Returns one message per displayed offer or candidate that the recorded responses do not reproduce. */
export function revalidate(log: SmokeLog): string[] {
  const problems: string[] = [];
  const answers = log.exaExchanges.filter((e) => e.endpoint === "/answer").map((e) => parseAnswerResponse(e.response));
  const searches = log.exaExchanges.filter((e) => e.endpoint === "/search").map((e) => parseSearchResponse(e.response));
  const runUrls = new Set(searches.flatMap((s) => s.hits.map((h) => h.url)));

  for (const product of log.displayed.products ?? []) {
    const name = `${product.candidate.brand} ${product.candidate.name}`;
    if (!answers.some((a) => a.candidates.some((c) => JSON.stringify(c) === JSON.stringify(product.candidate)))) {
      problems.push(`${name}: candidate is not in the recorded answer`);
    }
    for (const offer of product.offerGroups.flatMap((g) => g.offers)) {
      const search = searches.find((s) => s.exaRequestId === offer.exaRequestId);
      if (!search) {
        problems.push(`${offer.canonicalUrl}: no recorded search response with request ${offer.exaRequestId}`);
        continue;
      }
      const again = search.hits
        .map((hit) => classifyHit({ ...hit, retrievedAt: offer.retrievedAt }, product.candidate, runUrls))
        .filter((r): r is Offer => r.kind === "merchant-offer");
      if (!again.some((o) => JSON.stringify(o) === JSON.stringify(offer))) problems.push(`${offer.canonicalUrl}: reclassification differs from what was displayed`);
    }
  }
  return problems;
}

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^jm-004-smoke-.*\.json$/.test(f)) : [];
const offersOf = (log: SmokeLog) => (log.displayed.products ?? []).flatMap((p) => p.offerGroups.flatMap((g) => g.offers));

describe.skipIf(files.length === 0)("live smoke revalidation (committed logs)", () => {
  it.each(files)("%s: every displayed offer is reproduced from the recorded responses", (file) => {
    const log = JSON.parse(readFileSync(join(DIR, file), "utf8")) as SmokeLog;
    expect(revalidate(log)).toEqual([]);
  });

  it("Q1 displayed at least one merchant offer", () => {
    const q1 = files.find((f) => f.endsWith("-Q1.json"));
    if (!q1) return;
    const log = JSON.parse(readFileSync(join(DIR, q1), "utf8")) as SmokeLog;
    expect(log.finalState).toBe("completed");
    expect(offersOf(log).length).toBeGreaterThan(0);
  });
});

describe("revalidate detects a changed display", () => {
  const candidate: Candidate = { name: "WH-1000XM5 Wireless Noise Cancelling Headphones", brand: "Sony", modelIdentifiers: ["WH-1000XM5"] };
  const response = frozen("S1-headphones").response;
  const answer = { requestId: "a", answer: { comparison: "x", candidates: [candidate] }, citations: [] };
  const search = parseSearchResponse(response);
  const retrievedAt = "2026-11-21T10:00:00.000Z";
  const runUrls = new Set(search.hits.map((h) => h.url));
  const offer = search.hits.map((h) => classifyHit({ ...h, retrievedAt }, candidate, runUrls)).find((r): r is Offer => r.kind === "merchant-offer")!;
  const logWith = (shown: Offer): SmokeLog => ({
    queryId: "T",
    finalState: "completed",
    exaExchanges: [
      { endpoint: "/answer", response: answer },
      { endpoint: "/search", response },
    ],
    displayed: { products: [{ candidate, offerGroups: [{ offers: [shown] }] }] },
  });

  it("accepts the faithful display and rejects a changed price or a made-up URL", () => {
    expect(revalidate(logWith(offer))).toEqual([]);
    expect(revalidate(logWith({ ...offer, price: { ...offer.price, amount: offer.price.amount - 1 } }))).toHaveLength(1);
    expect(revalidate(logWith({ ...offer, canonicalUrl: "https://made-up.example/x" }))).toHaveLength(1);
  });
});
