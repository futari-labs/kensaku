import type { Availability, Currency, EvidenceCategory } from "../../core/types";
import type { CandidateIdentity } from "../../research/events";

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The product's heading, with the brand once: the name alone when it already starts with the brand as a whole word, else "brand name". */
export function productTitle({ brand, name }: Pick<CandidateIdentity, "brand" | "name">): string {
  const b = brand.trim();
  const n = name.trim();
  if (b === "") return n;
  const startsWithBrand = n.slice(0, b.length).toLowerCase() === b.toLowerCase() && !/[\p{L}\p{N}_]/u.test(n.charAt(b.length));
  return startsWithBrand ? n : `${b} ${n}`;
}

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

/** Shown beside Exa text that was cut at leaked structured output, and in place of a comparison with nothing readable left (D-042). */
export const MALFORMED_NOTE = "Exa's answer ended in malformed output, which is not shown.";
