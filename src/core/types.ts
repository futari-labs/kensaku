// Declarations copied from docs/futari/ARCHITECTURE.md, "Interfaces and data" (including the v1.1 additions).
// Only the export list at the bottom is added.
type Market = "US" | "SG" | "JP";
type Currency = "USD" | "SGD" | "JPY";
type Availability = "in_stock" | "out_of_stock" | "preorder" | "unknown";
interface Candidate { name: string; brand: string; modelIdentifiers: string[]; keySpecs?: string[]; reason?: string }
interface OfferSummary { isProductListing?: boolean; productName?: string; merchant?: string;
  price?: number; currency?: string; availability?: string }           // as returned by Exa
interface SearchHit { url: string; title: string | null; summary: OfferSummary | null;
  exaRequestId: string; retrievedAt: string; image?: string | null }
interface Offer { kind: "merchant-offer"; merchantHost: string; merchantName: string;
  canonicalUrl: string; price: { amount: number; currency: Currency }; availability: Availability;
  source: "exa"; retrievedAt: string; exaRequestId: string; productName: string }
type EvidenceCategory = "aggregator" | "editorial" | "not-a-listing" | "merchant-no-price" | "merchant-mismatch"
  | "marketplace" | "search-or-category";
interface Evidence { kind: "evidence"; category: EvidenceCategory; url: string; title: string | null;
  host: string; reportedPrice?: { amount: number; currency: string } }
type RejectCategory = "irrelevant-product" | "unsupported-currency" | "url-not-from-run" | "invalid-url";
interface Rejected { kind: "rejected"; category: RejectCategory; url: string }
interface OfferGroup { currency: Currency; offers: Offer[] }
interface ResolvedCitations { renderedText: string; sources: string[]; unresolvedMarkers: number;
  uncitedParagraphs: number[] /* indexes; EV-004 compares .length with the case's count and sources.length with resolvedUrlCount */ }
interface ImageSource { imageUrl: string; pageUrl: string; sourceTitle: string }
interface ImageCandidate { id: string; sourceHost: string; sourceTitle: string }
type ImageUrlVerdict = "ok" | "invalid-url" | "bad-scheme" | "credentials" | "svg" | "deny-pattern";
type ImageBytesVerdict = "ok" | "too-large" | "unsupported-type" | "no-dimensions" | "too-small" | "aspect";
interface SniffedImage { type: "jpeg" | "png" | "webp" | "avif" | "gif" | "unknown"; width: number; height: number }

export type {
  Market,
  Currency,
  Availability,
  Candidate,
  OfferSummary,
  SearchHit,
  Offer,
  EvidenceCategory,
  Evidence,
  RejectCategory,
  Rejected,
  OfferGroup,
  ResolvedCitations,
  ImageSource,
  ImageCandidate,
  ImageUrlVerdict,
  ImageBytesVerdict,
  SniffedImage,
};
