import { z } from "zod";
import type { Candidate, OfferSummary, SearchHit } from "../core/types";
import { ExaFailure } from "./errors";

const CandidateSchema = z.object({
  name: z.string(),
  brand: z.string(),
  modelIdentifiers: z.array(z.string()),
});

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const OfferSummarySchema = z.object({
  isProductListing: lenient(z.boolean()),
  productName: lenient(z.string()),
  merchant: lenient(z.string()),
  price: lenient(z.number()),
  currency: lenient(z.string()),
  availability: lenient(z.string()),
});

const AnswerBodySchema = z.object({
  requestId: z.string().optional(),
  answer: z.object({ comparison: z.string(), candidates: z.array(CandidateSchema) }),
  citations: z.array(z.object({ url: z.string() })).default([]),
  costDollars: z.object({ total: z.number() }).optional(),
});

const SearchBodySchema = z.object({
  requestId: z.string().optional(),
  results: z.array(z.object({ url: z.string(), title: z.string().nullish(), summary: z.unknown().optional() })),
  costDollars: z.object({ total: z.number() }).optional(),
});

export interface ParsedAnswer {
  comparison: string;
  candidates: Candidate[];
  citationUrls: string[];
  exaRequestId: string;
  costDollars: number;
}

export interface ParsedSearch {
  hits: Omit<SearchHit, "retrievedAt">[];
  exaRequestId: string;
  costDollars: number;
}

function malformed(what: string): ExaFailure {
  return new ExaFailure("upstream", `Exa returned a malformed ${what} response.`);
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
    exaRequestId: r.data.requestId ?? "",
    costDollars: r.data.costDollars?.total ?? 0,
  };
}

/** Boundary parse of a raw `/search` response. */
export function parseSearchResponse(raw: unknown): ParsedSearch {
  const r = SearchBodySchema.safeParse(raw);
  if (!r.success) throw malformed("search");
  const exaRequestId = r.data.requestId ?? "";
  return {
    hits: r.data.results.map((hit) => ({
      url: hit.url,
      title: hit.title ?? null,
      summary: parseSummary(hit.summary),
      exaRequestId,
    })),
    exaRequestId,
    costDollars: r.data.costDollars?.total ?? 0,
  };
}

export { CandidateSchema };
