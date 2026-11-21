import { z } from "zod";
import type { ResolvedReason } from "../../core";
import type { Availability, Currency, Evidence, EvidenceCategory, ImageCandidate, Offer, OfferGroup, RejectCategory } from "../../core/types";
import { API_ERROR_KINDS, STAGES } from "../../research/events";
import type { CandidateIdentity, ComparisonNoticeData, ExaMode, ProductResult, ProgressData, SourceRef, UsageData } from "../../research/events";
import { MARKETS } from "./markets";
import type { ChatMessage, FailureData } from "./messages";

// `core` exports these unions as types only. Each list is checked against its union, in both directions, where it is declared.
const CURRENCIES = ["USD", "SGD", "JPY"] as const satisfies readonly Currency[];
const AVAILABILITIES = ["in_stock", "out_of_stock", "preorder", "unknown"] as const satisfies readonly Availability[];
const EVIDENCE_CATEGORIES = ["aggregator", "editorial", "not-a-listing", "merchant-no-price", "merchant-mismatch", "marketplace", "search-or-category"] as const satisfies readonly EvidenceCategory[];
const REJECT_CATEGORIES = ["irrelevant-product", "unsupported-currency", "url-not-from-run", "invalid-url"] as const satisfies readonly RejectCategory[];
const everyValueListed: [Exclude<Currency, (typeof CURRENCIES)[number]>, Exclude<Availability, (typeof AVAILABILITIES)[number]>, Exclude<EvidenceCategory, (typeof EVIDENCE_CATEGORIES)[number]>, Exclude<RejectCategory, (typeof REJECT_CATEGORIES)[number]>] extends [never, never, never, never] ? true : never = true;
void everyValueListed;

// Loose objects keep any field a newer server adds; the declared fields are what the page reads, and `satisfies` ties them to the stream's types.
const CurrencySchema = z.enum(CURRENCIES);
const CandidateSchema = z.looseObject({ name: z.string(), brand: z.string(), modelIdentifiers: z.array(z.string()) }) satisfies z.ZodType<CandidateIdentity>;
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
const ImageCandidateSchema = z.looseObject({ id: z.string(), sourceHost: z.string(), sourceTitle: z.string() }) satisfies z.ZodType<ImageCandidate>;
const ReasonSchema = z.looseObject({
  renderedText: z.string(),
  sources: z.array(z.string()),
  unresolvedMarkers: z.number(),
  uncitedParagraphs: z.array(z.number()),
  citedSources: z.array(z.looseObject({ url: z.string(), numbers: z.array(z.number()) })),
  truncated: z.boolean(),
}) satisfies z.ZodType<ResolvedReason>;
const ProductResultSchema = z.looseObject({
  candidate: CandidateSchema,
  offerGroups: z.array(OfferGroupSchema),
  evidence: z.array(EvidenceSchema),
  rejectedCounts: z.record(z.enum(REJECT_CATEGORIES), z.number()),
  notSearched: z.string().optional(),
  // Absent in history saved by the MVP.
  keySpecs: z.array(z.string()).optional(),
  reason: ReasonSchema.nullable().optional(),
  imageCandidates: z.array(ImageCandidateSchema).optional(),
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
const ComparisonNoticeSchema = z.looseObject({ truncated: z.literal(true) }) satisfies z.ZodType<ComparisonNoticeData>;
const FailureSchema = z.looseObject({ kind: z.enum(API_ERROR_KINDS), message: z.string(), partial: z.boolean() }) satisfies z.ZodType<FailureData>;
const SourceSchema = z.looseObject({ type: z.literal("source-url"), sourceId: z.string(), url: z.string() }) satisfies z.ZodType<SourceRef & { type: "source-url" }>;

const PartSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("text"), text: z.string() }),
  SourceSchema,
  z.looseObject({ type: z.literal("data-progress"), data: ProgressSchema }),
  z.looseObject({ type: z.literal("data-products"), data: z.array(ProductResultSchema) }),
  z.looseObject({ type: z.literal("data-comparison"), data: ComparisonNoticeSchema }),
  z.looseObject({ type: z.literal("data-usage"), data: UsageSchema }),
  z.looseObject({ type: z.literal("data-error"), data: FailureSchema }),
]);

export const StoredMessageSchema = z.looseObject({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(PartSchema),
  metadata: z.looseObject({ market: z.enum(MARKETS).optional() }).optional(),
}) satisfies z.ZodType<ChatMessage>;

/** The reply of `GET /api/health`; only the mode matters to the page. */
export const HealthSchema = z.object({ mode: z.enum(["live", "fixture"]) }) satisfies z.ZodType<{ mode: ExaMode }>;
