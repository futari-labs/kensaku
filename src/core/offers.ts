import {
  AGGREGATOR_HOSTS,
  EDITORIAL_HOSTS,
  MARKETPLACE_HOSTS,
  isEditorialPath,
  hostLabels,
  isSearchOrCategoryPage,
  matchesHostList,
} from "./hosts";
import { hasValidPrice, isAvailability, isSupportedCurrency } from "./currency";
import { identityTextOf, matchesIdentity, tokenize } from "./identity";
import { canonicalizeUrl, merchantHostOf } from "./url";
import type {
  Candidate,
  Evidence,
  EvidenceCategory,
  Offer,
  OfferSummary,
  Rejected,
  RejectCategory,
  SearchHit,
} from "./types";

const MERCHANT_STOPWORDS = new Set(
  "com co net jp sg us www store shop online official singapore japan usa inc ltd the".split(" "),
);

// Unambiguous currency symbols (D-032). A bare "$" is deliberately absent.
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  "S$": "SGD",
  "SG$": "SGD",
  "US$": "USD",
  "¥": "JPY",
  "￥": "JPY",
  "円": "JPY",
  "JP¥": "JPY",
};

function normalizeCurrency(currency: unknown): string | null {
  if (typeof currency !== "string") return null;
  const trimmed = currency.trim();
  const code = Object.hasOwn(CURRENCY_SYMBOLS, trimmed) ? CURRENCY_SYMBOLS[trimmed]! : trimmed.toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function reportedPriceOf(summary: OfferSummary | null): Evidence["reportedPrice"] {
  const currency = summary?.currency?.trim().toUpperCase();
  if (typeof summary?.price !== "number" || !Number.isFinite(summary.price) || !currency) return undefined;
  return { amount: summary.price, currency };
}

function merchantMatchesHost(merchant: string, hostname: string): boolean {
  if (merchant === "") return false;
  const tokens = tokenize(merchant).filter((token) => token.length >= 3 && !MERCHANT_STOPWORDS.has(token));
  const asciiTokens = tokens.filter((token) => /^[a-z0-9]+$/.test(token));
  if (asciiTokens.length === 0) return true;
  const labels = hostLabels(hostname);
  return asciiTokens.some((token) => labels.some((label) => label.includes(token)));
}

/** Classifies one search result. The first matching rule in ARCHITECTURE.md "Offer classification" decides. */
export function classifyHit(
  hit: SearchHit,
  candidate: Candidate,
  runResultUrls: ReadonlySet<string>,
): Offer | Evidence | Rejected {
  const rejected = (category: RejectCategory): Rejected => ({ kind: "rejected", category, url: hit.url });

  let url: URL;
  try {
    url = new URL(hit.url);
  } catch {
    return rejected("invalid-url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return rejected("invalid-url");
  if (!runResultUrls.has(hit.url)) return rejected("url-not-from-run");

  const summary = hit.summary;
  const identityText = identityTextOf(hit);
  if (!matchesIdentity(identityText, candidate)) return rejected("irrelevant-product");

  const host = url.hostname;
  const currency = normalizeCurrency(summary?.currency);
  const reportedPrice = reportedPriceOf(summary);
  const evidence = (category: EvidenceCategory): Evidence => ({
    kind: "evidence",
    category,
    url: hit.url,
    title: hit.title,
    host,
    ...(reportedPrice ? { reportedPrice } : {}),
  });

  if (matchesHostList(url, AGGREGATOR_HOSTS)) return evidence("aggregator");
  if (matchesHostList(url, EDITORIAL_HOSTS)) return evidence("editorial");
  if (matchesHostList(url, MARKETPLACE_HOSTS)) return evidence("marketplace");
  if (isSearchOrCategoryPage(url)) return evidence("search-or-category");
  if (isEditorialPath(url)) return evidence("editorial");
  if (summary?.isProductListing !== true) return evidence("not-a-listing");
  if (currency === null || !hasValidPrice(summary.price, currency)) return evidence("merchant-no-price");
  if (!isSupportedCurrency(currency)) return rejected("unsupported-currency");
  const merchantName = summary.merchant?.trim() ?? "";
  if (!merchantMatchesHost(merchantName, host)) return evidence("merchant-mismatch");

  return {
    kind: "merchant-offer",
    merchantHost: merchantHostOf(url),
    merchantName,
    canonicalUrl: canonicalizeUrl(hit.url),
    price: { amount: summary.price, currency },
    availability: isAvailability(summary.availability) ? summary.availability : "unknown",
    source: "exa",
    retrievedAt: hit.retrievedAt,
    exaRequestId: hit.exaRequestId,
    productName: identityText,
  };
}
