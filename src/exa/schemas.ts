import { z } from "zod";
import type { AnswerResult, SearchResult } from "./port";

/** The single home for zod schemas of Exa data. `satisfies` ties each stored shape to its interface. */

export const CandidateSchema = z.object({
  name: z.string(),
  brand: z.string(),
  modelIdentifiers: z.array(z.string()),
});

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

/** Each field is dropped, not rejected, when Exa returns the wrong type for it. */
export const OfferSummarySchema = z.object({
  isProductListing: lenient(z.boolean()),
  productName: lenient(z.string()),
  merchant: lenient(z.string()),
  price: lenient(z.number()),
  currency: lenient(z.string()),
  availability: lenient(z.string()),
});

const SearchHitSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  summary: OfferSummarySchema.nullable(),
  exaRequestId: z.string(),
  retrievedAt: z.string(),
});

export const StoredAnswerSchema = z.object({
  comparison: z.string(),
  candidates: z.array(CandidateSchema),
  citationUrls: z.array(z.string()),
  exaRequestId: z.string(),
  retrievedAt: z.string(),
  costDollars: z.number(),
}) satisfies z.ZodType<Omit<AnswerResult, "cached">>;

export const StoredSearchSchema = z.object({
  hits: z.array(SearchHitSchema),
  exaRequestId: z.string(),
  retrievedAt: z.string(),
  costDollars: z.number(),
}) satisfies z.ZodType<Omit<SearchResult, "cached">>;
