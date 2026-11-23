// The shapes of an EV-016 run log. The raw part of a query record is written before anything is derived from it.
import type { Evidence, Market, Offer, Rejected, SniffedImage } from "../../src/core/types";
import type { ProductResult } from "../../src/research/events";

/** One offer row as the page rendered it. */
export interface UiOffer {
  host: string;
  price: string;
  availability: string;
  line: string;
  href: string;
  placement: "main" | "other-markets";
}

export interface UiProduct {
  title: string;
  /** `loaded`: a candidate loaded through the proxy; `fallback`: the "No verified product image" panel; `pending`: neither when the page was read. */
  image: { state: "loaded" | "fallback" | "pending"; src: string | null; caption: string };
  reason: { text: string; note: boolean } | null;
  offers: UiOffer[];
}

export interface UiSnapshot {
  turnState: string | null;
  comparison: string[];
  comparisonNote: boolean;
  products: UiProduct[];
}

/** One candidate of a product's image list: what the proxy answered the page, and what the proxy's registry holds. */
export interface ImageProbe {
  id: string;
  sourceHost: string;
  sourceTitle: string;
  /** False when the page never asked for it (an earlier candidate loaded). */
  requested: boolean;
  status: number | null;
  contentType: string | null;
  sniffed: SniffedImage | null;
  bytes: number;
  imageUrl: string | null;
  pageUrl: string | null;
  registryVerdict: unknown;
}

export interface ProductImages {
  candidates: ImageProbe[];
  /** The candidate the page showed, from the page's own `<img src>`. */
  loadedId: string | null;
}

export interface ExaExchangeRecord {
  ts: string;
  endpoint: string;
  request: unknown;
  response: unknown;
  requestId: string | null;
  costDollars: number | null;
}

export interface QueryRecord {
  queryId: string;
  market: Market;
  question: string;
  startedAt: string;
  gitSha: string;
  httpStatus: number | null;
  /** The turn's `data-state` once the page reached a terminal state, or `timeout`. */
  finalState: string;
  error: unknown;
  exaExchanges: ExaExchangeRecord[];
  exaCalls: unknown[];
  displayed: {
    comparison: { text: string; sources: { sourceId: string; url: string }[] } | null;
    comparisonTruncated: boolean;
    products: ProductResult[] | null;
  };
  ui: UiSnapshot;
  images: ProductImages[];
  browser: { origins: string[]; requestCount: number };
  usage: unknown;
  totals: { exaRequests: number; costDollars: number };
  serverLog: unknown[];
}

export interface PriceDisplay {
  pass: boolean;
  detail: string;
}

export interface AuditOffer {
  id: string;
  queryId: string;
  product: string;
  offer: Offer;
  placement: "main" | "other-markets" | "not shown";
  reproduced: boolean;
  fromRun: boolean;
  /** The recorded hit for the URL classifies as this under the v1.1 rules. */
  now: Offer | Evidence | Rejected | undefined;
  uiMatches: boolean;
  priceDisplay: PriceDisplay;
  problem: string | undefined;
}

export interface AuditImage {
  id: string;
  /** The proxy id of the candidate that loaded (`/api/image/<candidateId>`). */
  candidateId: string;
  queryId: string;
  product: string;
  sourceHost: string;
  sourceTitle: string;
  imageUrl: string | null;
  pageUrl: string | null;
  sniffed: SniffedImage | null;
  bytes: number;
  /** File name under the image folder; the extension is the sniffed type. */
  file: string;
  passes: boolean;
  problem: string | undefined;
}

export interface QueryAnalysis {
  offers: AuditOffer[];
  images: AuditImage[];
  /** Candidate lists that do not re-derive from the recorded Exa response (rules I1 and I2). */
  imageListProblems: string[];
  candidateProblems: string[];
  braces: string[];
  /** Cards with at least one offer, and how many of them show a loaded image. */
  offerCards: { total: number; withImage: number };
  nonLocalOrigins: string[];
}

export type AnalyzedQuery = QueryRecord & { analysis: QueryAnalysis };
