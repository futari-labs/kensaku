// The deterministic EV-016 thresholds (evals/cases/live-acceptance-v1-1.json "thresholds"), computed from the analyzed queries.
// The two owner-audit thresholds are not here: the coordinator fills them from the audit sheet.
import type { AnalyzedQuery } from "./types";

export interface Check {
  name: string;
  /** The number the run produced, with what it counts. */
  actual: string;
  required: string;
  pass: boolean;
}

export interface ThresholdSpec {
  queriesWithAtLeastOneMerchantOffer: { min: number; of: number };
  singaporeQueriesWithAnSgdOfferInTheMainList: { min: number; of: number; queries: string[] };
  displayedOffers: { min: number };
  displayedImages: { min: number };
}

const share = (part: number, whole: number) => (whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`);

export function evaluateThresholds(spec: ThresholdSpec, queries: readonly AnalyzedQuery[], notRun: readonly { queryId: string; reason: string }[]): Check[] {
  const offers = queries.flatMap((q) => q.analysis.offers);
  const images = queries.flatMap((q) => q.analysis.images);
  const withOffer = queries.filter((q) => q.analysis.offers.length > 0).length;
  const sg = spec.singaporeQueriesWithAnSgdOfferInTheMainList;
  const sgWithSgd = queries.filter((q) => sg.queries.includes(q.queryId) && q.analysis.offers.some((o) => o.placement === "main" && o.offer.price.currency === "SGD")).length;
  const revalidated = offers.filter((o) => o.reproduced && o.uiMatches).length;
  const searchPages = offers.filter((o) => o.now?.kind === "evidence" && o.now.category === "search-or-category").length;
  const fabricated = offers.filter((o) => !o.fromRun).length;
  const cards = queries.reduce((n, q) => n + q.analysis.offerCards.total, 0);
  const cardsWithImage = queries.reduce((n, q) => n + q.analysis.offerCards.withImage, 0);
  const imageFailures = images.filter((i) => !i.passes).length + queries.reduce((n, q) => n + q.analysis.imageListProblems.length, 0);
  const braces = queries.reduce((n, q) => n + q.analysis.braces.length, 0);
  const origins = queries.reduce((n, q) => n + q.analysis.nonLocalOrigins.length, 0);
  const unexpected = queries.filter((q) => q.finalState !== "completed").length + notRun.length;
  const check = (name: string, actual: string, required: string, pass: boolean): Check => ({ name, actual, required, pass });
  return [
    check("queriesWithAtLeastOneMerchantOffer", `${withOffer} of ${queries.length + notRun.length}`, `at least ${spec.queriesWithAtLeastOneMerchantOffer.min} of ${spec.queriesWithAtLeastOneMerchantOffer.of}`, withOffer >= spec.queriesWithAtLeastOneMerchantOffer.min),
    check("singaporeQueriesWithAnSgdOfferInTheMainList", `${sgWithSgd} of ${sg.of}`, `at least ${sg.min} of ${sg.of}`, sgWithSgd >= sg.min),
    check("displayedOffers", `${offers.length}`, `at least ${spec.displayedOffers.min}`, offers.length >= spec.displayedOffers.min),
    check("displayedOffersPassingRevalidation", `${revalidated} of ${offers.length} (${share(revalidated, offers.length)})`, "100%", revalidated === offers.length),
    check("searchOrCategoryPagesDisplayedAsOffers", `${searchPages}`, "0", searchPages === 0),
    check("fabricatedOffers", `${fabricated}`, "0", fabricated === 0),
    check("displayedImages", `${images.length}`, `at least ${spec.displayedImages.min}`, images.length >= spec.displayedImages.min),
    check("productsWithAnOfferShowingAProductImage", `${cardsWithImage} of ${cards} offer-bearing cards (${share(cardsWithImage, cards)})`, "at least 70%", cards > 0 && cardsWithImage / cards >= 0.7),
    check("displayedImagesPassingRevalidation", `${images.length - images.filter((i) => !i.passes).length} of ${images.length}, ${queries.reduce((n, q) => n + q.analysis.imageListProblems.length, 0)} candidate-list problem(s)`, "100%, no candidate-list problem", imageFailures === 0),
    check("displayedComparisonsOrReasonsContainingBraces", `${braces}`, "0", braces === 0),
    check("browserRequestsToNonLocalOrigins", `${origins}`, "0", origins === 0),
    check("unexpectedErrorRuns", `${unexpected}`, "0", unexpected === 0),
  ];
}
