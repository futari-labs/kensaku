import { z } from "zod";
import type { Market } from "../../core/types";
import type { KensakuMessage } from "./messages";

export const HISTORY_KEY = "kensaku.history.v1";
export const MARKET_KEY = "kensaku.market.v1";
const HISTORY_VERSION = 1;

export const MARKETS = ["US", "SG", "JP"] as const satisfies readonly Market[];
export const MARKET_LABEL: Record<Market, string> = { US: "United States (USD)", SG: "Singapore (SGD)", JP: "Japan (JPY)" };
export const DEFAULT_MARKET: Market = "US";

/** Runs a localStorage operation; storage may be absent, full, or blocked, and the app must work without it. */
function attempt<T>(fallback: T, op: (storage: Storage) => T): T {
  try {
    return op(window.localStorage);
  } catch {
    return fallback;
  }
}

export const loadMarket = (): Market => {
  const stored = attempt<string | null>(null, (s) => s.getItem(MARKET_KEY));
  return MARKETS.find((m) => m === stored) ?? DEFAULT_MARKET;
};

export const saveMarket = (market: Market): void => attempt(undefined, (s) => s.setItem(MARKET_KEY, market));

const Currency = z.enum(["USD", "SGD", "JPY"]);
const Offer = z.looseObject({
  merchantHost: z.string(),
  merchantName: z.string(),
  canonicalUrl: z.string(),
  productName: z.string(),
  price: z.looseObject({ amount: z.number(), currency: Currency }),
  availability: z.enum(["in_stock", "out_of_stock", "preorder", "unknown"]),
  retrievedAt: z.string(),
});
const Evidence = z.looseObject({
  category: z.enum(["aggregator", "editorial", "not-a-listing", "merchant-no-price", "merchant-mismatch"]),
  url: z.string(),
  title: z.string().nullable(),
  host: z.string(),
  reportedPrice: z.looseObject({ amount: z.number(), currency: z.string() }).optional(),
});
const ProductResult = z.looseObject({
  candidate: z.looseObject({ name: z.string(), brand: z.string() }),
  offerGroups: z.array(z.looseObject({ currency: Currency, offers: z.array(Offer) })),
  evidence: z.array(Evidence),
  rejectedCounts: z.record(z.string(), z.number()),
  notSearched: z.string().optional(),
});
const ErrorKind = z.enum(["auth", "credits_exhausted", "monthly_limit", "rate_limited", "upstream", "timeout", "invalid_request", "run_in_progress"]);
const Part = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("text"), text: z.string() }),
  z.looseObject({ type: z.literal("source-url"), sourceId: z.string(), url: z.string() }),
  z.looseObject({
    type: z.literal("data-progress"),
    data: z.looseObject({ stage: z.enum(["candidates", "offers", "validate", "compare"]), status: z.enum(["running", "done", "failed"]), detail: z.string().optional() }),
  }),
  z.looseObject({ type: z.literal("data-products"), data: z.array(ProductResult) }),
  z.looseObject({
    type: z.literal("data-usage"),
    data: z.looseObject({ exaRequests: z.number(), cacheHits: z.number(), costDollars: z.number(), monthRequests: z.number(), monthLimit: z.number() }),
  }),
  z.looseObject({ type: z.literal("data-error"), data: z.looseObject({ kind: ErrorKind, message: z.string(), partial: z.boolean() }) }),
]);
const StoredMessage = z.looseObject({ id: z.string(), role: z.enum(["user", "assistant"]), parts: z.array(Part) });
const StoredHistory = z.object({ version: z.literal(HISTORY_VERSION), messages: z.array(StoredMessage), savedAt: z.string() });

export type HistoryNotice = "unreadable" | "newer";
export interface LoadedHistory {
  messages: KensakuMessage[];
  /** Set when stored data was discarded; the person is told once. */
  notice: HistoryNotice | undefined;
}

/** The stored conversation, or an empty one with a notice when the stored value is invalid or from a newer version (and then removed). */
export function loadHistory(): LoadedHistory {
  const raw = attempt<string | null>(null, (s) => s.getItem(HISTORY_KEY));
  if (raw === null) return { messages: [], notice: undefined };
  let notice: HistoryNotice = "unreadable";
  try {
    const json: unknown = JSON.parse(raw);
    const parsed = StoredHistory.safeParse(json);
    // The messages were checked part by part above; the schema's output types are looser than KensakuMessage's.
    if (parsed.success) return { messages: parsed.data.messages as unknown as KensakuMessage[], notice: undefined };
    if (typeof json === "object" && json !== null && "version" in json && typeof json.version === "number" && json.version > HISTORY_VERSION) notice = "newer";
  } catch {
    // not JSON
  }
  clearHistory();
  return { messages: [], notice };
}

export const saveHistory = (messages: KensakuMessage[]): void =>
  attempt(undefined, (s) => s.setItem(HISTORY_KEY, JSON.stringify({ version: HISTORY_VERSION, messages, savedAt: new Date().toISOString() })));

export const clearHistory = (): void => attempt(undefined, (s) => s.removeItem(HISTORY_KEY));
