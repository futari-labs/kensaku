import type { ImageBytesVerdict } from "../../core";

/** Why an upstream fetch produced no bytes. Each one is a 502 and is cached for 10 minutes. */
export type FetchFailure =
  | "blocked-address"
  | "blocked-port"
  | "upstream-status"
  | "timeout"
  | "too-large"
  | "too-many-redirects"
  | "network-error";

export type FetchResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: FetchFailure };

export interface ImageFetchPort {
  fetch(url: string, signal: AbortSignal): Promise<FetchResult>;
}

/** The outcome of the last upstream fetch for one image, kept in its registry entry. */
export type Verdict =
  | { status: "ok"; type: "jpeg" | "png" | "webp" | "avif"; fetchedAt: number }
  | { status: "rejected"; reason: Exclude<ImageBytesVerdict, "ok">; fetchedAt: number }
  | { status: "failed"; reason: FetchFailure; fetchedAt: number };

export interface RegistryEntry {
  url: string;
  pageUrl: string;
  registeredAt: number;
  verdict?: Verdict;
}
