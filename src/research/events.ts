import type { Candidate, Evidence, Market, OfferGroup, RejectCategory } from "../core/types";

export const STAGES = ["candidates", "offers", "validate", "compare"] as const;
export type Stage = (typeof STAGES)[number];

/** The errors a run can end with, as the UI message stream's `data-error` names them (plus `invalid_request`, which the server adds). */
export type RunErrorKind = "auth" | "credits_exhausted" | "monthly_limit" | "rate_limited" | "upstream" | "timeout";

export interface ProductResult {
  candidate: Candidate;
  offerGroups: OfferGroup[];
  evidence: Evidence[];
  rejectedCounts: Record<RejectCategory, number>;
  /** Why this candidate has no search results, when it was not searched or its search did not complete. */
  notSearched?: string;
}

export interface RunUsage {
  exaRequests: number;
  cacheHits: number;
  costDollars: number;
}

export interface SourceRef {
  /** Citation numbers this URL has in the rendered text, joined with commas (`"1,4"`). */
  sourceId: string;
  url: string;
}

export type RunState = "completed" | "failed" | "cancelled";

/** What `runResearch` yields. Every run ends with exactly one `end`; a failed run has one `error` before it. */
export type RunEvent =
  | { type: "progress"; stage: Stage; status: "running" | "done" | "failed"; detail?: string }
  | { type: "comparison"; text: string; sources: SourceRef[] }
  | { type: "products"; products: ProductResult[] }
  | { type: "usage"; usage: RunUsage }
  | { type: "error"; kind: RunErrorKind; message: string; partial: boolean }
  | { type: "end"; state: RunState };

export interface RunInput {
  question: string;
  market: Market;
}
