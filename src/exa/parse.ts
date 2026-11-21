import { z } from "zod";
import type { Candidate, OfferSummary, SearchHit } from "../core/types";
import { ExaFailure } from "./errors";
import { CandidateSchema, OfferSummarySchema } from "./schemas";

/** What every response is billed for, read before and independently of strict parsing. */
export interface Billing {
  costDollars: number;
  /** False when the response carried no usable `costDollars.total`; the cost is then recorded as 0. */
  costReported: boolean;
}

const BillingSchema = z.object({
  costDollars: z.object({ total: z.number().finite().nonnegative() }),
});

/** Never throws. A received response is billed whether or not its body is usable. */
export function readBilling(raw: unknown): Billing {
  const r = BillingSchema.safeParse(raw);
  return r.success ? { costDollars: r.data.costDollars.total, costReported: true } : { costDollars: 0, costReported: false };
}

const RequestId = z.string().min(1);

const AnswerBodySchema = z.object({
  requestId: RequestId,
  answer: z.object({ comparison: z.string(), candidates: z.array(CandidateSchema) }),
  citations: z
    .array(z.object({ url: z.string() }))
    .nullish()
    .transform((c) => c ?? []),
});

const SearchBodySchema = z.object({
  requestId: RequestId,
  results: z.array(z.unknown()),
});

const SearchRowSchema = z.object({ url: z.string(), title: z.string().nullish(), summary: z.unknown().optional() });

export interface ParsedAnswer {
  comparison: string;
  candidates: Candidate[];
  citationUrls: string[];
  exaRequestId: string;
}

export interface ParsedSearch {
  hits: Omit<SearchHit, "retrievedAt">[];
  exaRequestId: string;
  /** Result rows dropped because they were malformed. */
  skipped: number;
}

function malformed(what: string): ExaFailure {
  // Not retryable: the request was answered and billed, so retrying it only spends another request.
  return new ExaFailure("upstream", `Exa returned a malformed ${what} response.`, { retryable: false });
}

function parseSummary(raw: unknown): OfferSummary | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = OfferSummarySchema.safeParse(value);
  if (!parsed.success) return null;
  const out: OfferSummary = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Boundary parse of a raw `/answer` response (live SDK result or a frozen fixture). */
export function parseAnswerResponse(raw: unknown): ParsedAnswer {
  const r = AnswerBodySchema.safeParse(raw);
  if (!r.success) throw malformed("answer");
  return {
    comparison: r.data.answer.comparison,
    candidates: r.data.answer.candidates.slice(0, 3),
    citationUrls: r.data.citations.map((c) => c.url),
    exaRequestId: r.data.requestId,
  };
}

/** Boundary parse of a raw `/search` response. A malformed row is skipped and counted, not fatal. */
export function parseSearchResponse(raw: unknown): ParsedSearch {
  const r = SearchBodySchema.safeParse(raw);
  if (!r.success) throw malformed("search");
  const exaRequestId = r.data.requestId;
  const hits: ParsedSearch["hits"] = [];
  let skipped = 0;
  for (const row of r.data.results) {
    const hit = SearchRowSchema.safeParse(row);
    if (!hit.success) {
      skipped += 1;
      continue;
    }
    hits.push({ url: hit.data.url, title: hit.data.title ?? null, summary: parseSummary(hit.data.summary), exaRequestId });
  }
  return { hits, exaRequestId, skipped };
}
