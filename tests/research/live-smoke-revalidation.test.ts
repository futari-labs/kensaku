// Revalidation of the committed live logs under .futari/evidence/live/ (JM-004 smoke logs, one per
// query, and EV-008 suite run logs, one per run): every displayed offer is reclassified from the
// recorded Exa response and must equal what was displayed. See revalidate.ts. Skips when none exist.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyHit } from "../../src/core";
import type { Candidate, Offer } from "../../src/core/types";
import { parseSearchResponse } from "../../src/exa/parse";
import { frozen } from "../exa/helpers";
import { offersOf, revalidate, revalidateRun } from "./revalidate";
import type { RecordedRun } from "./revalidate";

const DIR = join(import.meta.dirname, "../../.futari/evidence/live");

type SmokeLog = RecordedRun;
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^jm-004-smoke-.*\.json$/.test(f)) : [];
const suiteFiles = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^ev-008-run-\d+-.*\.json$/.test(f)) : [];

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

describe.skipIf(suiteFiles.length === 0)("EV-008 suite run logs (committed)", () => {
  // The MVP logs are history (EVALUATION_PLAN "Historical live logs"): under the v1.1 rules exactly one displayed offer
  // changes class, Q5-O1 in run 1 (a Rakuten search page, rule 5b), and nothing else does.
  it.each(suiteFiles)("%s: every displayed offer is reproduced, except Q5-O1 of run 1", (file) => {
    const run = JSON.parse(readFileSync(join(DIR, file), "utf8")) as { queries: RecordedRun[] };
    const revalidated = run.queries.map((query) => ({ query, ...revalidateRun(query) }));
    for (const { candidateProblems } of revalidated) expect(candidateProblems).toEqual([]);
    const changed = revalidated.flatMap(({ query, offers }) => offers.filter((o) => !o.reproduced).map((o) => ({ queryId: query.queryId, ...o })));
    if (!file.startsWith("ev-008-run-1-")) {
      expect(changed).toEqual([]);
      return;
    }
    expect(changed.map((o) => o.queryId)).toEqual(["Q5"]);
    const [q5] = changed;
    expect(q5!.offer.merchantHost).toBe("search.rakuten.co.jp");
    expect(q5!.fromRun).toBe(true);
    expect(q5!.now).toMatchObject({ kind: "evidence", category: "search-or-category" });
    const q5Offers = offersOf(run.queries.find((q) => q.queryId === "Q5")!);
    expect(q5Offers[0]!.offer.canonicalUrl).toBe(q5!.offer.canonicalUrl);
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
