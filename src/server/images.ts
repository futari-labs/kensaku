import { createHash } from "node:crypto";
import { imageBytesVerdict, sniffImage } from "../core";
import type { ImageCandidate, ImageSource, SniffedImage } from "../core";
import { MAX_IMAGE_BYTES } from "./images/network";
import { ID_PATTERN, ImageStore } from "./images/store";
import type { FetchResult, ImageFetchPort, RegistryEntry, Verdict } from "./images/types";

export { isAllowedAddress } from "./images/address";
export { FixtureImageFetch } from "./images/fixture";
export { connectPinned, NetworkImageFetch } from "./images/network";
export type { Connect, NetworkFetchOptions, PinnedResponse } from "./images/network";
export type { FetchFailure, FetchResult, ImageFetchPort } from "./images/types";

export const DEFAULT_IMAGE_DIR = ".cache/images";

const HOUR = 3_600_000;
const OK_TTL_MS = 7 * 24 * HOUR;
const REJECTED_TTL_MS = 24 * HOUR;
const FAILED_TTL_MS = 10 * 60_000;
const REGISTRATION_TTL_MS = 30 * 24 * HOUR;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_CONCURRENT_FETCHES = 4;
const DEFAULT_CACHE_CAP_BYTES = 500 * 1024 * 1024;

type ServedType = Extract<Verdict, { status: "ok" }>["type"];
const CONTENT_TYPES: Record<ServedType, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };
const isServed = (type: SniffedImage["type"]): type is ServedType => type in CONTENT_TYPES;

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
};

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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function reply(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { ...SECURITY_HEADERS, "Cache-Control": "no-store" } });
}

const ttlOf = (verdict: Verdict) => (verdict.status === "ok" ? OK_TTL_MS : verdict.status === "rejected" ? REJECTED_TTL_MS : FAILED_TTL_MS);

/**
 * The local image proxy (ARCHITECTURE, "Image proxy (v1.1)"). It fetches only URLs that a run
 * registered, validates the bytes with rule I3, and caches each outcome on disk. It takes no Exa
 * budget token and writes no Exa ledger.
 */
export class ImageProxy {
  private readonly store: ImageStore;
  private readonly inFlight = new Map<string, Promise<Verdict>>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;

  constructor(private readonly options: ImageProxyOptions) {
    this.store = new ImageStore(options.dir ?? DEFAULT_IMAGE_DIR);
    this.prune();
  }

  /** Records this run's image URLs so the proxy may fetch them, and returns the candidates the browser gets. */
  registerImageCandidates(sources: readonly ImageSource[]): ImageCandidate[] {
    const now = this.options.clock().getTime();
    const candidates = sources.map((source): ImageCandidate => {
      const id = idOf(source.imageUrl);
      const verdict = this.store.read(id)?.verdict;
      this.store.write(id, { url: source.imageUrl, pageUrl: source.pageUrl, registeredAt: now, ...(verdict && { verdict }) });
      return { id, sourceHost: hostOf(source.pageUrl), sourceTitle: source.sourceTitle };
    });
    this.prune();
    return candidates;
  }

  /** `GET /api/image/:id`. `secFetchSite` is the request's header, if it had one. */
  async serve(id: string, secFetchSite: string | undefined): Promise<Response> {
    if (secFetchSite !== undefined && secFetchSite !== "same-origin") return reply(403, "cross-site");
    if (!ID_PATTERN.test(id)) return reply(404, "unknown-image");
    const entry = this.store.read(id);
    if (!entry) return reply(404, "unknown-image");
    const cached = entry.verdict && this.options.clock().getTime() - entry.verdict.fetchedAt < ttlOf(entry.verdict) ? this.respond(id, entry.verdict) : undefined;
    return cached ?? this.respond(id, await this.refresh(id, entry)) ?? reply(502, "network-error");
  }

  private respond(id: string, verdict: Verdict): Response | undefined {
    if (verdict.status === "rejected") return reply(422, verdict.reason);
    if (verdict.status === "failed") return reply(502, verdict.reason);
    const bytes = this.store.readBytes(id);
    if (!bytes) return undefined;
    return new Response(Buffer.from(bytes), {
      headers: { ...SECURITY_HEADERS, "Content-Type": CONTENT_TYPES[verdict.type], "Cache-Control": "private, max-age=604800" },
    });
  }

  private refresh(id: string, entry: RegistryEntry): Promise<Verdict> {
    const pending = this.inFlight.get(id) ?? this.fetchOnce(id, entry).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, pending);
    return pending;
  }

  private async fetchOnce(id: string, entry: RegistryEntry): Promise<Verdict> {
    await this.acquire();
    const started = performance.now();
    let bytes = 0;
    let verdict: Verdict;
    try {
      const result = await this.fetchWithTimeout(entry.url);
      const fetchedAt = this.options.clock().getTime();
      if (!result.ok) verdict = { status: "failed", reason: result.reason, fetchedAt };
      else if (result.bytes.length > MAX_IMAGE_BYTES) verdict = { status: "failed", reason: "too-large", fetchedAt };
      else {
        bytes = result.bytes.length;
        const sniffed = sniffImage(result.bytes);
        const rule = imageBytesVerdict(sniffed, bytes);
        if (rule === "ok" && isServed(sniffed.type)) {
          this.store.writeBytes(id, result.bytes);
          verdict = { status: "ok", type: sniffed.type, fetchedAt };
        } else verdict = { status: "rejected", reason: rule === "ok" ? "unsupported-type" : rule, fetchedAt };
      }
    } finally {
      this.release();
    }
    if (verdict.status !== "ok") this.store.deleteBytes(id);
    this.store.write(id, { ...(this.store.read(id) ?? entry), verdict });
    this.options.log({
      event: "image_fetch",
      id,
      host: new URL(entry.url).host,
      verdict: verdict.status === "ok" ? "ok" : verdict.reason,
      bytes,
      durationMs: Math.round(performance.now() - started),
    });
    return verdict;
  }

  private async fetchWithTimeout(url: string): Promise<FetchResult> {
    const controller = new AbortController();
    const timeout: FetchResult = { ok: false, reason: "timeout" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<FetchResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(timeout);
      }, FETCH_TIMEOUT_MS);
    });
    try {
      const fetched = this.options.port.fetch(url, controller.signal).catch((): FetchResult => ({ ok: false, reason: "network-error" }));
      return await Promise.race([fetched, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async acquire(): Promise<void> {
    if (this.active >= MAX_CONCURRENT_FETCHES) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }

  /** Deletes entries registered over 30 days ago, then evicts the oldest-fetched bytes while the cache is over its cap. */
  private prune(): void {
    const now = this.options.clock().getTime();
    const cap = this.options.maxCacheBytes ?? DEFAULT_CACHE_CAP_BYTES;
    const cached: Array<{ id: string; entry: RegistryEntry; fetchedAt: number; size: number }> = [];
    for (const id of this.store.ids()) {
      const entry = this.store.read(id);
      if (!entry || now - entry.registeredAt > REGISTRATION_TTL_MS) this.store.delete(id);
      else if (entry.verdict?.status === "ok") cached.push({ id, entry, fetchedAt: entry.verdict.fetchedAt, size: this.store.byteSize(id) });
    }
    let total = cached.reduce((sum, c) => sum + c.size, 0);
    for (const { id, entry, size } of cached.sort((a, b) => a.fetchedAt - b.fetchedAt)) {
      if (total <= cap) break;
      this.store.deleteBytes(id);
      this.store.write(id, { url: entry.url, pageUrl: entry.pageUrl, registeredAt: entry.registeredAt });
      total -= size;
    }
  }
}
