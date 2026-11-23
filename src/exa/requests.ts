import { createHash } from "node:crypto";
import type { Candidate, Market } from "../core/types";

export type Endpoint = "/answer" | "/search";

const MARKET_NAME: Record<Market, string> = { US: "United States", SG: "Singapore", JP: "Japan" };

/** Binding: deep-equals `request.body.outputSchema` of the frozen fixture V9 (EV-017). */
export const ANSWER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    comparison: { type: "string", description: "Short comparison with numbered citation markers like [1]." },
    candidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          brand: { type: "string" },
          modelIdentifiers: {
            type: "array",
            items: { type: "string" },
            description:
              "Manufacturer model names or model numbers only (for example WH-1000XM5 or MX Master 3S). No features, specifications, colours, connectivity, or generation labels.",
          },
          keySpecs: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
            description: "Up to 5 short key specifications, each under 60 characters.",
          },
          reason: {
            type: "string",
            description:
              "One or two sentences on why this product fits the question, with numbered citation markers like [1]. Do not mention prices or currency amounts.",
          },
        },
        required: ["name", "brand", "modelIdentifiers", "keySpecs", "reason"],
      },
    },
  },
  required: ["comparison", "candidates"],
} as const;

export const OFFER_SUMMARY_QUERY = "Extract the product listing's price, currency, availability and merchant.";

export const OFFER_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    isProductListing: { type: "boolean", description: "True only if this page sells one specific product." },
    productName: { type: "string" },
    merchant: { type: "string", description: "Store or seller name shown on the page." },
    price: { type: "number", description: "Current listed price as a number, no symbols. Omit if not shown." },
    currency: { type: "string", description: "ISO 4217 code such as USD. Omit if not shown." },
    availability: { type: "string", enum: ["in_stock", "out_of_stock", "preorder", "unknown"] },
  },
  required: ["isProductListing"],
} as const;

/** How /answer learns the market. `userLocation` on /answer is unverified (ARCHITECTURE, stage `candidates`). */
export type AnswerMarketMode = "userLocation" | "question-text";

export interface AnswerRequest {
  query: string;
  text: false;
  outputSchema: typeof ANSWER_OUTPUT_SCHEMA;
  userLocation?: Market;
}

export interface SearchRequest {
  query: string;
  options: {
    type: "auto";
    numResults: 8;
    userLocation: Market;
    contents: {
      highlights: true;
      summary: { query: string; schema: typeof OFFER_SUMMARY_SCHEMA };
    };
  };
}

export function buildAnswerRequest(question: string, market: Market, mode: AnswerMarketMode): AnswerRequest {
  const base = { text: false, outputSchema: ANSWER_OUTPUT_SCHEMA } as const;
  return mode === "userLocation"
    ? { query: question, ...base, userLocation: market }
    : { query: `${question}\nMarket: ${MARKET_NAME[market]}`, ...base };
}

export function buildSearchRequest(candidate: Candidate, market: Market): SearchRequest {
  return {
    query: `${candidate.brand} ${candidate.name} price ${MARKET_NAME[market]} buy`,
    options: {
      type: "auto",
      numResults: 8,
      userLocation: market,
      contents: { highlights: true, summary: { query: OFFER_SUMMARY_QUERY, schema: OFFER_SUMMARY_SCHEMA } },
    },
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    );
  }
  return value;
}

function normalizeText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Cache key: SHA-256 of `{endpoint, normalized request body, market}` (ARCHITECTURE, Research pipeline). */
export function cacheKey(endpoint: Endpoint, body: AnswerRequest | SearchRequest, market: Market): string {
  const normalized = { ...body, query: normalizeText(body.query) };
  return createHash("sha256").update(JSON.stringify(stable({ endpoint, body: normalized, market }))).digest("hex");
}
