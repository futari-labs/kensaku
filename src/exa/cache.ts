import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "./files";

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const EntrySchema = z.object({ version: z.literal(1), value: z.unknown() });

export interface CacheOptions {
  dir: string;
  ttlMs?: number;
}

/**
 * Disk cache at `<dir>/<key>.json`. A hit is valid while `now - retrievedAt < ttl`, so the TTL runs
 * from the original response, and the stored value keeps its original `retrievedAt`. `now` comes
 * from the port. Unreadable or malformed entries are misses.
 */
export class DiskCache {
  readonly #dir: string;
  readonly #ttlMs: number;

  constructor(options: CacheOptions) {
    this.#dir = options.dir;
    this.#ttlMs = options.ttlMs ?? CACHE_TTL_MS;
  }

  get<T extends { retrievedAt: string }>(key: string, schema: z.ZodType<T>, now: Date): T | undefined {
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
    const age = now.getTime() - Date.parse(value.data.retrievedAt);
    return age >= 0 && age < this.#ttlMs ? value.data : undefined;
  }

  set(key: string, value: { retrievedAt: string }): void {
    writeJsonAtomic(join(this.#dir, `${key}.json`), { version: 1, value });
  }
}
