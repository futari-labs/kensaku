import { AGGREGATOR_HOSTS, EDITORIAL_HOSTS, matchesHostList } from "./hosts";
import { matchesIdentity } from "./identity";
import { canonicalizeUrl, merchantHostOf } from "./url";
import type {
  Availability,
  Candidate,
  Currency,
  Evidence,
  EvidenceCategory,
  Offer,
  Rejected,
  RejectCategory,
  SearchHit,
} from "./types";

const SUPPORTED_CURRENCIES: readonly string[] = ["USD", "SGD", "JPY"];
const AVAILABILITIES: readonly string[] = ["in_stock", "out_of_stock", "preorder", "unknown"];
const MERCHANT_STOPWORDS = new Set(
  "com co net jp sg us www store shop online official singapore japan usa inc ltd the".split(" "),
);

function normalizeCurrency(currency: unknown): string | null {
  if (typeof currency !== "string") return null;
  const code = currency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function hasValidPrice(price: unknown, currency: string | null): price is number {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || currency === null) return false;
  if (currency === "JPY") return Number.isInteger(price);
  if (currency === "USD" || currency === "SGD") return Number.isInteger(Number((price * 100).toFixed(6)));
  return true;
}

function merchantMatchesHost(merchant: string | undefined, hostname: string): boolean {
  if (merchant === undefined || merchant.trim() === "") return false;
  const tokens = merchant
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((token) => token.length >= 3 && !MERCHANT_STOPWORDS.has(token));
  const asciiTokens = tokens.filter((token) => /^[a-z0-9]+$/.test(token));
  if (asciiTokens.length === 0) return true;
  const labels = hostname.split(/[.-]/);
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
  const identityText = summary?.productName?.trim() ? summary.productName : (hit.title ?? "");
  if (!matchesIdentity(identityText, candidate)) return rejected("irrelevant-product");

  const host = url.hostname.toLowerCase();
  const currency = normalizeCurrency(summary?.currency);
  const evidence = (category: EvidenceCategory): Evidence => ({
    kind: "evidence",
    category,
    url: hit.url,
    title: hit.title,
    host,
    ...(typeof summary?.price === "number" && Number.isFinite(summary.price) && summary.currency?.trim()
      ? { reportedPrice: { amount: summary.price, currency: summary.currency.trim() } }
      : {}),
  });

  if (matchesHostList(url, AGGREGATOR_HOSTS)) return evidence("aggregator");
  if (matchesHostList(url, EDITORIAL_HOSTS)) return evidence("editorial");
  if (summary?.isProductListing !== true) return evidence("not-a-listing");
  if (!hasValidPrice(summary.price, currency)) return evidence("merchant-no-price");
  if (!SUPPORTED_CURRENCIES.includes(currency!)) return rejected("unsupported-currency");
  if (!merchantMatchesHost(summary.merchant, host)) return evidence("merchant-mismatch");

  const availability: Availability = AVAILABILITIES.includes(summary.availability ?? "")
    ? (summary.availability as Availability)
    : "unknown";
  return {
    kind: "merchant-offer",
    merchantHost: merchantHostOf(url),
    merchantName: summary.merchant!.trim(),
    canonicalUrl: canonicalizeUrl(hit.url),
    price: { amount: summary.price, currency: currency as Currency },
    availability,
    source: "exa",
    retrievedAt: hit.retrievedAt,
    exaRequestId: hit.exaRequestId,
    productName: identityText,
  };
}
