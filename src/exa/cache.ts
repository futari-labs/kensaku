import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import { writeJsonAtomic } from "./files";
import { CandidateSchema } from "./parse";

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const SearchHitSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  summary: z
    .object({
      isProductListing: z.boolean().optional(),
      productName: z.string().optional(),
      merchant: z.string().optional(),
      price: z.number().optional(),
      currency: z.string().optional(),
      availability: z.string().optional(),
    })
    .nullable(),
  exaRequestId: z.string(),
  retrievedAt: z.string(),
});

export const StoredAnswerSchema = z.object({
  comparison: z.string(),
  candidates: z.array(CandidateSchema),
  citationUrls: z.array(z.string()),
  exaRequestId: z.string(),
  retrievedAt: z.string(),
  costDollars: z.number(),
});

export const StoredSearchSchema = z.object({
  hits: z.array(SearchHitSchema),
  exaRequestId: z.string(),
  retrievedAt: z.string(),
  costDollars: z.number(),
});

const EntrySchema = z.object({ version: z.literal(1), value: z.unknown() });

export interface CacheOptions {
  dir: string;
  ttlMs?: number;
  clock?: Clock;
}

/**
 * Disk cache at `<dir>/<key>.json`. A hit is valid while `now - retrievedAt < ttl`, so the TTL runs
 * from the original response, and the stored value keeps its original `retrievedAt`. Unreadable or
 * malformed entries are misses.
 */
export class DiskCache {
  readonly #dir: string;
  readonly #ttlMs: number;
  readonly #clock: Clock;

  constructor(options: CacheOptions) {
    this.#dir = options.dir;
    this.#ttlMs = options.ttlMs ?? CACHE_TTL_MS;
    this.#clock = options.clock ?? systemClock;
  }

  get<T extends { retrievedAt: string }>(key: string, schema: z.ZodType<T>): T | undefined {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(this.#dir, `${key}.json`), "utf8"));
    } catch {
      return undefined;
    }
    const entry = EntrySchema.safeParse(raw);
    if (!entry.success) return undefined;
    const value = schema.safeParse(entry.data.value);
    if (!value.success) return undefined;
    const age = this.#clock().getTime() - Date.parse(value.data.retrievedAt);
    return age >= 0 && age < this.#ttlMs ? value.data : undefined;
  }

  set(key: string, value: { retrievedAt: string }): void {
    writeJsonAtomic(join(this.#dir, `${key}.json`), { version: 1, value });
  }
}
