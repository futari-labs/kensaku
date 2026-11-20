import type { Candidate, Market, SearchHit } from "../core/types";
import type { RequestBudget } from "./budget";

export type { Candidate, Market, OfferSummary, SearchHit } from "../core/types";
export { RequestBudget } from "./budget";
export type { BudgetToken } from "./budget";
export { ExaFailure } from "./errors";
export type { ExaFailureKind } from "./errors";

export interface AnswerResult {
  comparison: string;
  candidates: Candidate[];
  citationUrls: string[];
  exaRequestId: string;
  retrievedAt: string;
  costDollars: number;
  cached: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  exaRequestId: string;
  retrievedAt: string;
  costDollars: number;
  cached: boolean;
}

export interface ExaPort {
  answerCandidates(question: string, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<AnswerResult>;
  searchOffers(candidate: Candidate, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<SearchResult>;
}
