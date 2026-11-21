import { z } from "zod";
import type { Availability, Candidate, Currency, Evidence, EvidenceCategory, Offer, OfferGroup, RejectCategory } from "../../core/types";
import { API_ERROR_KINDS, STAGES } from "../../research/events";
import type { ExaMode, ProductResult, ProgressData, SourceRef, UsageData } from "../../research/events";
import type { ChatMessage, FailureData } from "./messages";

// `core` exports these unions as types only. Each list is checked against its union, in both directions, where it is declared.
const CURRENCIES = ["USD", "SGD", "JPY"] as const satisfies readonly Currency[];
const AVAILABILITIES = ["in_stock", "out_of_stock", "preorder", "unknown"] as const satisfies readonly Availability[];
const EVIDENCE_CATEGORIES = ["aggregator", "editorial", "not-a-listing", "merchant-no-price", "merchant-mismatch"] as const satisfies readonly EvidenceCategory[];
const REJECT_CATEGORIES = ["irrelevant-product", "unsupported-currency", "url-not-from-run", "invalid-url"] as const satisfies readonly RejectCategory[];
const everyValueListed: [Exclude<Currency, (typeof CURRENCIES)[number]>, Exclude<Availability, (typeof AVAILABILITIES)[number]>, Exclude<EvidenceCategory, (typeof EVIDENCE_CATEGORIES)[number]>, Exclude<RejectCategory, (typeof REJECT_CATEGORIES)[number]>] extends [never, never, never, never] ? true : never = true;
void everyValueListed;

// Loose objects keep any field a newer server adds; the declared fields are what the page reads, and `satisfies` ties them to the stream's types.
const CurrencySchema = z.enum(CURRENCIES);
const CandidateSchema = z.looseObject({ name: z.string(), brand: z.string(), modelIdentifiers: z.array(z.string()) }) satisfies z.ZodType<Candidate>;
const OfferSchema = z.looseObject({
  kind: z.literal("merchant-offer"),
  merchantHost: z.string(),
  merchantName: z.string(),
  canonicalUrl: z.string(),
  price: z.looseObject({ amount: z.number(), currency: CurrencySchema }),
  availability: z.enum(AVAILABILITIES),
  source: z.literal("exa"),
  retrievedAt: z.string(),
  exaRequestId: z.string(),
  productName: z.string(),
}) satisfies z.ZodType<Offer>;
const OfferGroupSchema = z.looseObject({ currency: CurrencySchema, offers: z.array(OfferSchema) }) satisfies z.ZodType<OfferGroup>;
const EvidenceSchema = z.looseObject({
  kind: z.literal("evidence"),
  category: z.enum(EVIDENCE_CATEGORIES),
  url: z.string(),
  title: z.string().nullable(),
  host: z.string(),
  reportedPrice: z.looseObject({ amount: z.number(), currency: z.string() }).optional(),
}) satisfies z.ZodType<Evidence>;
const ProductResultSchema = z.looseObject({
  candidate: CandidateSchema,
  offerGroups: z.array(OfferGroupSchema),
  evidence: z.array(EvidenceSchema),
  rejectedCounts: z.record(z.enum(REJECT_CATEGORIES), z.number()),
  notSearched: z.string().optional(),
}) satisfies z.ZodType<ProductResult>;

const ProgressSchema = z.looseObject({
  stage: z.enum(STAGES),
  status: z.enum(["running", "done", "failed"]),
  detail: z.string().optional(),
}) satisfies z.ZodType<ProgressData>;
const UsageSchema = z.looseObject({
  exaRequests: z.number(),
  cacheHits: z.number(),
  costDollars: z.number(),
  monthRequests: z.number(),
  monthLimit: z.number(),
}) satisfies z.ZodType<UsageData>;
const FailureSchema = z.looseObject({ kind: z.enum(API_ERROR_KINDS), message: z.string(), partial: z.boolean() }) satisfies z.ZodType<FailureData>;
const SourceSchema = z.looseObject({ type: z.literal("source-url"), sourceId: z.string(), url: z.string() }) satisfies z.ZodType<SourceRef & { type: "source-url" }>;

const PartSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("text"), text: z.string() }),
  SourceSchema,
  z.looseObject({ type: z.literal("data-progress"), data: ProgressSchema }),
  z.looseObject({ type: z.literal("data-products"), data: z.array(ProductResultSchema) }),
  z.looseObject({ type: z.literal("data-usage"), data: UsageSchema }),
  z.looseObject({ type: z.literal("data-error"), data: FailureSchema }),
]);

export const StoredMessageSchema = z.looseObject({ id: z.string(), role: z.enum(["user", "assistant"]), parts: z.array(PartSchema) }) satisfies z.ZodType<ChatMessage>;

/** The reply of `GET /api/health`; only the mode matters to the page. */
export const HealthSchema = z.object({ mode: z.enum(["live", "fixture"]) }) satisfies z.ZodType<{ mode: ExaMode }>;
