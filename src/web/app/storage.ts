import { z } from "zod";
import type { Market } from "../../core/types";
import { DEFAULT_MARKET, MARKETS } from "./markets";
import type { ChatMessage } from "./messages";
import { StoredMessageSchema } from "./schemas";

export const HISTORY_KEY = "kensaku.history.v1";
export const MARKET_KEY = "kensaku.market.v1";
const HISTORY_VERSION = 1;

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

const StoredHistory = z.object({ version: z.literal(HISTORY_VERSION), messages: z.array(StoredMessageSchema), savedAt: z.string() });

export type HistoryNotice = "unreadable" | "newer";
export interface LoadedHistory {
  messages: ChatMessage[];
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
    if (parsed.success) return { messages: parsed.data.messages, notice: undefined };
    if (typeof json === "object" && json !== null && "version" in json && typeof json.version === "number" && json.version > HISTORY_VERSION) notice = "newer";
  } catch {
    // not JSON
  }
  clearHistory();
  return { messages: [], notice };
}

export const saveHistory = (messages: ChatMessage[]): void =>
  attempt(undefined, (s) => s.setItem(HISTORY_KEY, JSON.stringify({ version: HISTORY_VERSION, messages, savedAt: new Date().toISOString() })));

export const clearHistory = (): void => attempt(undefined, (s) => s.removeItem(HISTORY_KEY));
