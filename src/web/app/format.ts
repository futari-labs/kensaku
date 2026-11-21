import type { Availability, Currency, EvidenceCategory } from "../../core/types";

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function formatPrice(amount: number, currency: Currency): string {
  const digits = currency === "JPY" ? 0 : 2;
  return `${amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  in_stock: "In stock",
  out_of_stock: "Out of stock",
  preorder: "Preorder",
  unknown: "Availability unknown",
};

export const formatTime = (iso: string): string => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export const EVIDENCE_LABEL: Record<EvidenceCategory, string> = {
  aggregator: "Price aggregator",
  editorial: "Editorial review",
  "not-a-listing": "Not a product listing",
  "merchant-no-price": "Merchant page without a valid price",
  "merchant-mismatch": "Merchant name does not match the site",
  marketplace: "Second-hand marketplace",
  "search-or-category": "Search or category page",
};
