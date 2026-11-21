import type { Verdict } from "./types";

const HOUR = 3_600_000;

export const REGISTRATION_TTL_MS = 30 * 24 * HOUR;

/** How long each kind of verdict is reused before the image is fetched again. */
const VERDICT_TTL_MS: Record<Verdict["status"], number> = {
  ok: 7 * 24 * HOUR,
  rejected: 24 * HOUR,
  failed: 10 * 60_000,
};

/** What the proxy remembers about one image without opening its files. */
export interface CacheEntry {
  registeredAt: number;
  verdict?: Verdict;
  /** Bytes on disk; 0 when none. */
  size: number;
}

/** `absent` has no verdict; `stale` has one that is expired or an `ok` whose bytes are gone; `fresh` can be served as is. */
export function cacheState(entry: CacheEntry, now: number): "fresh" | "stale" | "absent" {
  const { verdict } = entry;
  if (!verdict) return "absent";
  if (verdict.status === "ok" && entry.size === 0) return "stale";
  return now - verdict.fetchedAt < VERDICT_TTL_MS[verdict.status] ? "fresh" : "stale";
}
