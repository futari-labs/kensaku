import { createHash } from "node:crypto";
import type { ImageCandidate, ImageSource } from "../core";
import { merchantHostOf } from "../core/url";
import { cacheState, REGISTRATION_TTL_MS } from "./images/cache";
import { classify } from "./images/classify";
import { withLimit, withTimeout } from "./images/limit";
import { ID_PATTERN, ImageStore } from "./images/store";
import { toResponse } from "./images/respond";
import type { Outcome } from "./images/respond";
import type { FetchResult, ImageFetchPort, RegistryEntry } from "./images/types";

export { isAllowedAddress } from "./images/address";
export { FixtureImageFetch } from "./images/fixture";
export { connectPinned, NetworkImageFetch } from "./images/network";
export type { Connect, NetworkFetchOptions, PinnedResponse } from "./images/network";
export { SECURITY_HEADERS } from "./images/respond";
export type { FetchFailure, FetchResult, ImageFetchPort } from "./images/types";

export const DEFAULT_IMAGE_DIR = ".cache/images";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_CONCURRENT_FETCHES = 4;
const DEFAULT_CACHE_CAP_BYTES = 500 * 1024 * 1024;

export interface ImageProxyOptions {
  port: ImageFetchPort;
  clock: () => Date;
  /** One JSON-able line per upstream fetch. */
  log: (line: Record<string, unknown>) => void;
  /** Defaults to `.cache/images`. */
  dir?: string;
  /** Defaults to 500 MB. */
  maxCacheBytes?: number;
}

const idOf = (imageUrl: string) => createHash("sha256").update(imageUrl).digest("hex");

/** The merchant host of a URL, or "" when it does not parse. Never throws. */
function hostOf(url: string): string {
  try {
    return merchantHostOf(new URL(url));
  } catch {
    return "";
  }
}

const TIMED_OUT: FetchResult = { ok: false, reason: "timeout" };
const NETWORK_ERROR: FetchResult = { ok: false, reason: "network-error" };

/**
 * The local image proxy (ARCHITECTURE, "Image proxy (v1.1)"). It fetches only URLs that a run
 * registered, validates the bytes with rule I3, and caches each outcome on disk. It takes no Exa
 * budget token and writes no Exa ledger.
 */
export class ImageProxy {
  private readonly store: ImageStore;
  private readonly inFlight = new Map<string, Promise<Outcome>>();
  private readonly limit = withLimit(MAX_CONCURRENT_FETCHES);

  constructor(private readonly options: ImageProxyOptions) {
    this.store = new ImageStore(options.dir ?? DEFAULT_IMAGE_DIR);
    this.prune();
  }

  /** Records this run's image URLs so the proxy may fetch them, and returns the candidates the browser gets. */
  registerImageCandidates(sources: readonly ImageSource[]): ImageCandidate[] {
    const now = this.options.clock().getTime();
    const candidates = sources.map((source): ImageCandidate => {
      const id = idOf(source.imageUrl);
      const verdict = this.store.index.get(id)?.verdict;
      this.store.write(id, { url: source.imageUrl, pageUrl: source.pageUrl, registeredAt: now, ...(verdict && { verdict }) });
      return { id, sourceHost: hostOf(source.pageUrl), sourceTitle: source.sourceTitle };
    });
    this.prune();
    return candidates;
  }

  /** `GET /api/image/:id`. `secFetchSite` is the request's header, if it had one. Always answers with the security headers. */
  async serve(id: string, secFetchSite: string | undefined): Promise<Response> {
    try {
      return toResponse(await this.resolve(id, secFetchSite));
    } catch {
      return toResponse({ status: "failed", reason: "network-error" });
    }
  }

  private async resolve(id: string, secFetchSite: string | undefined): Promise<Outcome> {
    if (secFetchSite !== undefined && secFetchSite !== "same-origin") return { status: "cross-site" };
    const cached = ID_PATTERN.test(id) ? this.store.index.get(id) : undefined;
    const entry = cached && this.store.read(id);
    if (!cached || !entry) return { status: "unknown-image" };
    const { verdict } = cached;
    if (verdict && cacheState(cached, this.options.clock().getTime()) === "fresh") {
      if (verdict.status !== "ok") return verdict;
      const bytes = this.store.readBytes(id);
      if (bytes) return { ...verdict, bytes };
    }
    return this.refresh(id, entry);
  }

  private refresh(id: string, entry: RegistryEntry): Promise<Outcome> {
    const pending = this.inFlight.get(id) ?? this.fetchOnce(id, entry).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, pending);
    return pending;
  }

  private async fetchOnce(id: string, entry: RegistryEntry): Promise<Outcome> {
    const started = performance.now();
    const result = await this.limit(() =>
      withTimeout(FETCH_TIMEOUT_MS, TIMED_OUT, (signal) => this.options.port.fetch(entry.url, signal).catch(() => NETWORK_ERROR)),
    );
    const classified = classify(result, this.options.clock().getTime());
    const { verdict } = classified;
    if (classified.accepted) this.store.writeBytes(id, classified.accepted);
    else this.store.deleteBytes(id);
    this.store.write(id, { ...(this.store.read(id) ?? entry), verdict });
    this.options.log({
      event: "image_fetch",
      id,
      host: hostOf(entry.url),
      verdict: verdict.status === "ok" ? "ok" : verdict.reason,
      bytes: classified.size,
      durationMs: Math.round(performance.now() - started),
    });
    return classified.accepted ? { ...classified.verdict, bytes: classified.accepted } : classified.verdict;
  }

  /** Deletes entries registered over 30 days ago, then evicts the oldest-fetched bytes while the cache is over its cap. Reads the index only. */
  private prune(): void {
    const now = this.options.clock().getTime();
    const cap = this.options.maxCacheBytes ?? DEFAULT_CACHE_CAP_BYTES;
    const cached: Array<{ id: string; fetchedAt: number; size: number }> = [];
    for (const [id, entry] of this.store.index) {
      if (now - entry.registeredAt > REGISTRATION_TTL_MS) this.store.delete(id);
      else if (entry.verdict?.status === "ok") cached.push({ id, fetchedAt: entry.verdict.fetchedAt, size: entry.size });
    }
    let total = cached.reduce((sum, c) => sum + c.size, 0);
    for (const { id, size } of cached.sort((a, b) => a.fetchedAt - b.fetchedAt)) {
      if (total <= cap) break;
      this.store.deleteBytes(id);
      const entry = this.store.read(id);
      if (entry) this.store.write(id, { url: entry.url, pageUrl: entry.pageUrl, registeredAt: entry.registeredAt });
      total -= size;
    }
  }
}
