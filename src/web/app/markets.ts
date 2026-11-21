import type { Currency, Market } from "../../core/types";

export const MARKETS = ["US", "SG", "JP"] as const satisfies readonly Market[];
export const MARKET_LABEL: Record<Market, string> = { US: "United States (USD)", SG: "Singapore (SGD)", JP: "Japan (JPY)" };
export const DEFAULT_MARKET: Market = "US";

/** What the card says about a market: its name in sentences, and the currency its main offer list uses (REQ-015). */
export const MARKET_INFO: Record<Market, { name: string; currency: Currency }> = {
  US: { name: "United States", currency: "USD" },
  SG: { name: "Singapore", currency: "SGD" },
  JP: { name: "Japan", currency: "JPY" },
};
