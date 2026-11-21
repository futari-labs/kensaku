import type { Market } from "../../core/types";

export const MARKETS = ["US", "SG", "JP"] as const satisfies readonly Market[];
export const MARKET_LABEL: Record<Market, string> = { US: "United States (USD)", SG: "Singapore (SGD)", JP: "Japan (JPY)" };
export const DEFAULT_MARKET: Market = "US";
