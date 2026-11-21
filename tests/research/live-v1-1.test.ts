// The pure parts of the EV-016 suite (scripts/live/): budget accounting from committed logs, revalidation of a recorded
// query (offers and images), threshold computation, and the owner audit sheet. The recorded query is the committed JM-104 smoke
// log of Q3, turned into the record shape the suite writes; nothing here calls Exa or a browser.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeQuery, analyze } from "../../scripts/live/analyze";
import { renderAuditSheet } from "../../scripts/live/audit";
import { committedUsage, mayStartQuery, planCapsOf, serverLimits, usageOfExchanges } from "../../scripts/live/budget";
import type { Budget } from "../../scripts/live/budget";
import { evaluateThresholds } from "../../scripts/live/thresholds";
import type { ThresholdSpec } from "../../scripts/live/thresholds";
import type { ImageProbe, QueryRecord, UiOffer } from "../../scripts/live/types";
import { offerView } from "../../src/web/app/offers";
import { AVAILABILITY_LABEL, formatPrice, productTitle } from "../../src/web/app/format";
import type { ProductResult } from "../../src/research/events";
import { MARKET_CURRENCY } from "../../src/core/currency";

const ROOT = join(import.meta.dirname, "../..");
const DIR = join(ROOT, ".futari/evidence/live");
const spec = JSON.parse(readFileSync(join(ROOT, "evals/cases/live-acceptance-v1-1.json"), "utf8")) as { budget: Budget; thresholds: ThresholdSpec & Record<string, unknown> };

describe("budget accounting", () => {
  it("reads the plan-wide caps from the frozen budget prose", () => {
    expect(planCapsOf(spec.budget)).toEqual({ requests: 130, costDollars: 1.5, minCostDollars: 0.05 });
    expect(() => planCapsOf({ planTotal: "no caps here" })).toThrow();
  });

  it("counts the JM-104 smoke logs and EV-016 run logs, not the MVP logs", () => {
    const exchanges = [{ costDollars: 0.005 }, { costDollars: 0.015 }, { costDollars: null }];
    const used = committedUsage([
      { name: "jm-104-smoke-Q3.json", json: { exaExchanges: exchanges } },
      { name: "ev-016-run-1-20261121T000000Z.json", json: { queries: [{ exaExchanges: exchanges }, { exaExchanges: exchanges.slice(0, 1) }] } },
      { name: "ev-008-run-1-20261121T000000Z.json", json: { queries: [{ exaExchanges: exchanges }] } },
      { name: "jm-004-smoke-Q1.json", json: { exaExchanges: exchanges } },
    ]);
    expect(used).toEqual({ requests: 7, costDollars: 0.045 });
  });

  it("refuses a query whose worst case passes any limit", () => {
    const b = spec.budget;
    expect(mayStartQuery(b, { requests: 5, costDollars: 0.055 }, { requests: 0, costDollars: 0 })).toEqual({ start: true });
    expect(mayStartQuery(b, { requests: 5, costDollars: 0.055 }, { requests: 36, costDollars: 0.3 })).toMatchObject({ start: false, reason: expect.stringContaining("run:") });
    expect(mayStartQuery(b, { requests: 5, costDollars: 0.055 }, { requests: 35, costDollars: 0.3 })).toEqual({ start: true });
    expect(mayStartQuery(b, { requests: 125, costDollars: 0.5 }, { requests: 1, costDollars: 0 })).toMatchObject({ start: false, reason: expect.stringContaining("plan-wide") });
    expect(mayStartQuery(b, { requests: 20, costDollars: 1.46 }, { requests: 0, costDollars: 0 })).toMatchObject({ start: false, reason: expect.stringContaining("floor") });
    expect(mayStartQuery(b, { requests: 0, costDollars: 0 }, { requests: 10, costDollars: 0.46 })).toMatchObject({ start: false, reason: expect.stringContaining("run:") });
  });

  it("caps the server's own ledger by what is left of the plan", () => {
    expect(serverLimits(spec.budget, { requests: 5, costDollars: 0.055 })).toEqual({ requests: 40, costDollars: 0.5 });
    expect(serverLimits(spec.budget, { requests: 100, costDollars: 1.4 })).toEqual({ requests: 30, costDollars: 0.1 });
  });
});

// A committed JM-104 smoke log, as the record the suite writes (page rows from the offer view, one `<img>` per card).
interface SmokeLog {
  queryId: string;
  market: QueryRecord["market"];
  question: string;
  exaExchanges: QueryRecord["exaExchanges"];
  displayed: { comparison: { text: string } | null; comparisonTruncated: boolean; products: ProductResult[] };
  summary: { imageProbes: { candidates: (ImageProbe & { sniffed: ImageProbe["sniffed"] })[] }[] };
}
const smokeFile = join(DIR, "jm-104-smoke-Q3.json");

function recordFromSmoke(log: SmokeLog): QueryRecord {
  const products = log.displayed.products;
  const rows = (product: ProductResult): UiOffer[] => {
    const view = offerView(product, log.market);
    const row = (o: { merchantHost: string; price: { amount: number; currency: "USD" | "SGD" | "JPY" }; availability: keyof typeof AVAILABILITY_LABEL; canonicalUrl: string }, placement: UiOffer["placement"]): UiOffer => ({
      host: o.merchantHost,
      price: formatPrice(o.price.amount, o.price.currency),
      availability: AVAILABILITY_LABEL[o.availability],
      line: "",
      href: o.canonicalUrl,
      placement,
    });
    return view.kind === "offers" ? [...view.local.map((o) => row(o, "main")), ...view.other.flatMap((g) => g.offers.map((o) => row(o, "other-markets")))] : [];
  };
  const images = log.summary.imageProbes.map(({ candidates }) => {
    const loaded = candidates.find((c) => c.status === 200);
    return { candidates: candidates.map((c) => ({ ...c, requested: true, registryVerdict: null })), loadedId: loaded?.id ?? null };
  });
  return {
    queryId: log.queryId,
    market: log.market,
    question: log.question,
    startedAt: "2026-11-21T00:00:00.000Z",
    gitSha: "0".repeat(40),
    httpStatus: 200,
    finalState: "completed",
    error: null,
    exaExchanges: log.exaExchanges,
    exaCalls: [],
    displayed: { comparison: log.displayed.comparison && { ...log.displayed.comparison, sources: [] }, comparisonTruncated: log.displayed.comparisonTruncated, products },
    ui: {
      turnState: "completed",
      comparison: log.displayed.comparison ? [log.displayed.comparison.text] : [],
      comparisonNote: false,
      products: products.map((product, i) => {
        const probes = images[i]!;
        const loaded = probes.candidates.find((c) => c.id === probes.loadedId);
        return {
          title: productTitle(product.candidate),
          image: loaded ? { state: "loaded", src: `/api/image/${loaded.id}`, caption: `Image: ${loaded.sourceHost} · ${loaded.sourceTitle}` } : { state: "fallback", src: null, caption: "" },
          reason: product.reason ? { text: product.reason.renderedText, note: false } : null,
          offers: rows(product),
        };
      }),
    },
    images,
    browser: { origins: ["http://127.0.0.1:8787"], requestCount: 20 },
    usage: null,
    totals: { exaRequests: log.exaExchanges.length, costDollars: usageOfExchanges(log.exaExchanges).costDollars },
    serverLog: [],
  };
}

describe.skipIf(!existsSync(smokeFile))("revalidation of a recorded query (JM-104 smoke Q3)", () => {
  const log = JSON.parse(readFileSync(smokeFile, "utf8")) as SmokeLog;
  const clone = () => structuredClone(recordFromSmoke(log));

  it("reproduces every offer and image of the faithful record", () => {
    const analysis = analyzeQuery(clone());
    expect(analysis.offers.length).toBeGreaterThan(0);
    expect(analysis.offers.map((o) => o.problem)).toEqual(analysis.offers.map(() => undefined));
    expect(analysis.offers.every((o) => o.reproduced && o.fromRun && o.uiMatches)).toBe(true);
    expect(analysis.offers.some((o) => o.placement === "main" && o.offer.price.currency === "SGD")).toBe(true);
    expect(analysis.candidateProblems).toEqual([]);
    expect(analysis.imageListProblems).toEqual([]);
    expect(analysis.images.length).toBeGreaterThan(0);
    expect(analysis.images.every((i) => i.passes)).toBe(true);
    expect(analysis.braces).toEqual([]);
    expect(analysis.nonLocalOrigins).toEqual([]);
    expect(analysis.offerCards.withImage).toBe(analysis.offerCards.total);
  });

  it("flags a page row whose price differs from the log", () => {
    const record = clone();
    record.ui.products.flatMap((p) => p.offers)[0]!.price = "1.00 SGD";
    const first = analyzeQuery(record).offers[0]!;
    expect(first.uiMatches).toBe(false);
    expect(first.priceDisplay.pass).toBe(false);
  });

  it("flags an offer row the log does not hold, and an offer the page does not show", () => {
    const extra = clone();
    extra.ui.products[0]!.offers.push({ host: "made-up.example", price: "1.00 SGD", availability: "In stock", line: "", href: "https://made-up.example/x", placement: "main" });
    expect(analyzeQuery(extra).candidateProblems).toHaveLength(1);
    const missing = clone();
    missing.ui.products[0]!.offers.pop();
    expect(analyzeQuery(missing).offers.some((o) => o.placement === "not shown" && !o.uiMatches)).toBe(true);
  });

  it("flags a candidate list that does not re-derive from the recorded Exa response", () => {
    const record = clone();
    record.displayed.products![0]!.imageCandidates!.pop();
    expect(analyzeQuery(record).imageListProblems.length).toBeGreaterThan(0);
  });

  it("flags a displayed image the proxy's own answer fails under rule I3", () => {
    const record = clone();
    const probe = record.images[0]!.candidates.find((c) => c.id === record.images[0]!.loadedId)!;
    probe.sniffed = { type: "jpeg", width: 150, height: 150 };
    expect(analyzeQuery(record).images[0]!.passes).toBe(false);
    probe.sniffed = { type: "png", width: 1000, height: 1000 };
    expect(analyzeQuery(record).images[0]!.problem).toContain("sniffed png");
  });

  it("flags a brace in a displayed comparison or reason", () => {
    const record = clone();
    record.ui.comparison.push("a leaked {structure");
    expect(analyzeQuery(record).braces).toEqual(["comparison paragraph 2 (page)"]);
  });

  it("flags a request to a non-local origin", () => {
    const record = clone();
    record.browser.origins.push("https://images.example");
    expect(analyzeQuery(record).nonLocalOrigins).toEqual(["https://images.example"]);
  });

  it("renders every displayed offer and image with empty owner columns", () => {
    const analyzed = analyze(clone());
    const sheet = renderAuditSheet(
      { runNumber: 1, logFile: "ev-016-run-1-x.json", gitSha: "abc", imageDir: "/tmp/images", shotDir: "/tmp/shots", auditRubric: ["offer rubric line"], imageAuditRubric: ["image rubric line"] },
      [analyzed],
    );
    expect(sheet).toContain(`Total displayed offers: ${analyzed.analysis.offers.length}.`);
    expect(sheet).toContain(`Total displayed images: ${analyzed.analysis.images.length}.`);
    expect(sheet).toContain("| Q3-O1 |");
    expect(sheet).toContain("| Q3-I1 |");
    const offerRow = sheet.split("\n").find((l) => l.startsWith("| Q3-O1 |"))!;
    expect(offerRow).toMatch(/\| main list \| {2}\| {2}\| pass \(/);
    const imageRow = sheet.split("\n").find((l) => l.startsWith("| Q3-I1 |"))!;
    expect(imageRow).toMatch(/\| pass \| {2}\|$/);
  });
});

describe("thresholds", () => {
  const thresholds = spec.thresholds;
  const base = (queryId: string, overrides: Partial<ReturnType<typeof analyzeQuery>> = {}, finalState = "completed") =>
    ({ queryId, finalState, analysis: { offers: [], images: [], imageListProblems: [], candidateProblems: [], braces: [], offerCards: { total: 0, withImage: 0 }, nonLocalOrigins: [], ...overrides } }) as never;
  const offer = (currency: "SGD" | "USD", placement: "main" | "other-markets") =>
    ({ placement, reproduced: true, uiMatches: true, fromRun: true, now: undefined, offer: { price: { amount: 1, currency } } }) as never;

  it("passes a run that meets every number and names each failing one", () => {
    const sgd = [offer("SGD", "main"), offer("SGD", "main"), offer("SGD", "main")];
    const queries = [
      ...["Q3", "Q4", "Q7", "Q8"].map((id) => base(id, { offers: sgd, images: Array.from({ length: 2 }, () => ({ passes: true }) as never), offerCards: { total: 1, withImage: 1 } })),
      ...["Q1", "Q2"].map((id) => base(id, { offers: [offer("USD", "main")], offerCards: { total: 1, withImage: 1 } })),
    ];
    const checks = evaluateThresholds(thresholds, queries, []);
    expect(checks.filter((c) => !c.pass).map((c) => c.name)).toEqual([]);

    const worse = [...queries.slice(0, 2), base("Q7"), base("Q8"), queries[4]!, base("Q5", {}, "failed")];
    const failing = evaluateThresholds(thresholds, worse, [{ queryId: "Q6", reason: "x" }]).filter((c) => !c.pass).map((c) => c.name);
    expect(failing).toEqual(expect.arrayContaining(["singaporeQueriesWithAnSgdOfferInTheMainList", "unexpectedErrorRuns"]));
    expect(MARKET_CURRENCY.SG).toBe("SGD");
  });

  it("fails on a search page shown as an offer, a fabricated offer, a brace, a non-local origin and a failing image", () => {
    const bad = {
      offers: [{ ...(offer("SGD", "main") as object), fromRun: false, now: { kind: "evidence", category: "search-or-category" } } as never],
      images: [{ passes: false } as never],
      braces: ["x"],
      nonLocalOrigins: ["https://e.example"],
      offerCards: { total: 1, withImage: 0 },
    };
    const failing = evaluateThresholds(thresholds, [base("Q3", bad)], []).filter((c) => !c.pass).map((c) => c.name);
    expect(failing).toEqual(
      expect.arrayContaining(["searchOrCategoryPagesDisplayedAsOffers", "fabricatedOffers", "displayedComparisonsOrReasonsContainingBraces", "browserRequestsToNonLocalOrigins", "displayedImagesPassingRevalidation", "productsWithAnOfferShowingAProductImage"]),
    );
  });
});

describe.skipIf(!existsSync(DIR) || !readdirSync(DIR).some((f) => /^ev-016-run-\d+-.*\.json$/.test(f)))("committed EV-016 run logs", () => {
  const runs = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^ev-016-run-\d+-.*\.json$/.test(f)) : [];
  it.each(runs)("%s: the derived fields equal a fresh analysis of the raw record", (file) => {
    const run = JSON.parse(readFileSync(join(DIR, file), "utf8")) as { queries: (QueryRecord & { analysis: unknown })[] };
    for (const { analysis, ...raw } of run.queries) expect(JSON.parse(JSON.stringify(analyzeQuery(raw as QueryRecord)))).toEqual(analysis);
  });
});
