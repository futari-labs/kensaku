import type { UIMessage } from "ai";
import { z } from "zod";
import type { ResolvedReason } from "../core";
import type { Candidate, Evidence, ImageCandidate, Market, OfferGroup, RejectCategory } from "../core/types";
import type { ExaFailureKind } from "../exa/errors";

export const STAGES = ["candidates", "offers", "validate", "compare"] as const;
export type Stage = (typeof STAGES)[number];

/** The errors a run can end with. `budget_exhausted` is never one: it ends the offers stage early instead. */
export type RunErrorKind = Exclude<ExaFailureKind, "budget_exhausted">;

/** Every `kind` an error reaches the client with: a run's own, or the HTTP 4xx bodies `POST /api/chat` returns. */
export type ApiErrorKind = RunErrorKind | "invalid_request" | "run_in_progress";

export const API_ERROR_KINDS = [
  "auth",
  "credits_exhausted",
  "monthly_limit",
  "rate_limited",
  "upstream",
  "timeout",
  "invalid_request",
  "run_in_progress",
] as const satisfies readonly ApiErrorKind[];

// Fails to compile when ApiErrorKind gains a member that API_ERROR_KINDS lacks.
const everyKindListed: Exclude<ApiErrorKind, (typeof API_ERROR_KINDS)[number]> extends never ? true : never = true;
void everyKindListed;

/** The body of a 4xx reply from `POST /api/chat`. */
export const ApiErrorBodySchema = z.object({ kind: z.enum(API_ERROR_KINDS), message: z.string() });

/** `"live"` calls Exa; `"fixture"` replays recorded scenarios (tests only). */
export type ExaMode = "live" | "fixture";

/** What a card shows of the candidate. The raw `keySpecs` and `reason` stay out: the card reads the normalized fields of `ProductResult`. */
export type CandidateIdentity = Pick<Candidate, "name" | "brand" | "modelIdentifiers">;

export interface ProductResult {
  candidate: CandidateIdentity;
  offerGroups: OfferGroup[];
  evidence: Evidence[];
  rejectedCounts: Record<RejectCategory, number>;
  /** Why this candidate has no search results, when it was not searched or its search did not complete. */
  notSearched?: string;
  /** (v1.1) Optional so history saved by the MVP still validates. The card reads these, never the raw `candidate` fields. */
  keySpecs?: string[];
  reason?: ResolvedReason | null;
  imageCandidates?: ImageCandidate[];
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
  /** The comparison cut at leaked structure (D-042). Nothing readable left means no text, and that is always a truncation. */
  | { type: "comparison"; text: string; truncated: boolean; sources: SourceRef[] }
  | { type: "comparison"; text: null; truncated: true; sources: [] }
  | { type: "products"; products: ProductResult[] }
  | { type: "usage"; usage: RunUsage }
  | { type: "error"; kind: RunErrorKind; message: string; partial: boolean }
  | { type: "end"; state: RunState };

type EventOf<T extends RunEvent["type"]> = Extract<RunEvent, { type: T }>;
export type ProgressData = Omit<EventOf<"progress">, "type">;
export type ErrorData = Omit<EventOf<"error">, "type">;
export type UsageData = RunUsage & { monthRequests: number; monthLimit: number };
/** Sent only when the comparison was cut or dropped, so a clean run streams exactly what the MVP did. */
export type ComparisonNoticeData = { truncated: true };

/** The `data-*` parts `POST /api/chat` streams, written by `toChunks` and read by the web app. */
export type KensakuDataParts = {
  progress: ProgressData;
  products: ProductResult[];
  comparison: ComparisonNoticeData;
  usage: UsageData;
  error: ErrorData;
};

export type KensakuMessage = UIMessage<unknown, KensakuDataParts>;

export interface RunInput {
  question: string;
  market: Market;
}
