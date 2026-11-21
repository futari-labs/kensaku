// Revalidation of a recorded live run: every displayed offer is reclassified from the recorded Exa
// response with `classifyHit` and must equal what was displayed. This is a self-consistency check (it
// detects display or pipeline mutation, not extraction errors; the owner audit covers those).
import { canonicalizeUrl, classifyHit } from "../../src/core";
import type { Candidate, Evidence, Offer, Rejected } from "../../src/core/types";
import { parseAnswerResponse, parseSearchResponse } from "../../src/exa/parse";

export interface Product {
  candidate: Candidate;
  offerGroups: { offers: Offer[] }[];
}
export interface RecordedRun {
  queryId: string;
  finalState: string;
  exaExchanges: { endpoint: string; response: unknown }[];
  displayed: { products: Product[] | null };
}

export interface OfferCheck {
  offer: Offer;
  candidate: Candidate;
  /** The reclassification from the recorded response equals the displayed offer. */
  reproduced: boolean;
  /** The displayed URL is one of this run's recorded search results. */
  fromRun: boolean;
  /** What the recorded hit for the displayed URL classifies as under the current rules. */
  now?: Offer | Evidence | Rejected;
  problem?: string;
}

export interface Revalidation {
  offers: OfferCheck[];
  /** Candidates shown that are not in the recorded answer. */
  candidateProblems: string[];
}

export const offersOf = (run: Pick<RecordedRun, "displayed">): { offer: Offer; candidate: Candidate }[] =>
  (run.displayed.products ?? []).flatMap((p) => p.offerGroups.flatMap((g) => g.offers.map((offer) => ({ offer, candidate: p.candidate }))));

export function revalidateRun(run: RecordedRun): Revalidation {
  const answers = run.exaExchanges.filter((e) => e.endpoint === "/answer").map((e) => parseAnswerResponse(e.response));
  const searches = run.exaExchanges.filter((e) => e.endpoint === "/search").map((e) => parseSearchResponse(e.response));
  const runUrls = new Set(searches.flatMap((s) => s.hits.map((h) => h.url)));
  const runCanonical = new Set([...runUrls].map((u) => canonicalizeUrl(u)));

  const candidateProblems: string[] = [];
  for (const product of run.displayed.products ?? []) {
    // v1.1 cards carry the identity only (name, brand, modelIdentifiers); the answer's candidate also holds keySpecs and reason.
    const identity = ({ name, brand, modelIdentifiers }: Candidate) => JSON.stringify({ name, brand, modelIdentifiers });
    if (!answers.some((a) => a.candidates.some((c) => identity(c) === identity(product.candidate)))) {
      candidateProblems.push(`${product.candidate.brand} ${product.candidate.name}: candidate is not in the recorded answer`);
    }
  }

  const offers = offersOf(run).map(({ offer, candidate }): OfferCheck => {
    const fromRun = runCanonical.has(offer.canonicalUrl);
    const search = searches.find((s) => s.exaRequestId === offer.exaRequestId);
    if (!search) {
      return { offer, candidate, reproduced: false, fromRun, problem: `${offer.canonicalUrl}: no recorded search response with request ${offer.exaRequestId}` };
    }
    const classified = search.hits.map((hit) => ({ hit, result: classifyHit({ ...hit, retrievedAt: offer.retrievedAt }, candidate, runUrls) }));
    const reproduced = classified.some(({ result }) => result.kind === "merchant-offer" && JSON.stringify(result) === JSON.stringify(offer));
    const now = classified.find(({ hit }) => canonicalizeUrl(hit.url) === offer.canonicalUrl)?.result;
    return { offer, candidate, reproduced, fromRun, ...(now && { now }), ...(!reproduced && { problem: `${offer.canonicalUrl}: reclassification differs from what was displayed` }) };
  });
  return { offers, candidateProblems };
}

/** Returns one message per displayed offer or candidate that the recorded responses do not reproduce. */
export function revalidate(run: RecordedRun): string[] {
  const { offers, candidateProblems } = revalidateRun(run);
  return [...candidateProblems, ...offers.flatMap((o) => (o.problem ? [o.problem] : []))];
}
