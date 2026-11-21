import { MARKET_CURRENCY } from "../../core/currency";
import type { Market } from "../../core/types";

export const MARKETS = ["US", "SG", "JP"] as const satisfies readonly Market[];
export const DEFAULT_MARKET: Market = "US";

/** The market's name in sentences (REQ-015). Its currency is `MARKET_CURRENCY`, the one fact `core` ranks by. */
export const MARKET_NAME: Record<Market, string> = { US: "United States", SG: "Singapore", JP: "Japan" };

export const MARKET_LABEL = Object.fromEntries(MARKETS.map((m) => [m, `${MARKET_NAME[m]} (${MARKET_CURRENCY[m]})`])) as Record<Market, string>;
