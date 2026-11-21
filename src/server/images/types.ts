import type { ImageBytesVerdict } from "../../core";

/** Why an upstream fetch produced no bytes. Each one is a 502 and is cached for 10 minutes. */
export type FetchFailure =
  | "invalid-url"
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

export type ServedType = "jpeg" | "png" | "webp" | "avif";

/** The outcome of the last upstream fetch for one image, kept in its registry entry. `too-large` is a failure, never a rejection: the 5 MiB stream cap fires first. */
export type Verdict =
  | { status: "ok"; type: ServedType; fetchedAt: number }
  | { status: "rejected"; reason: Exclude<ImageBytesVerdict, "ok" | "too-large">; fetchedAt: number }
  | { status: "failed"; reason: FetchFailure; fetchedAt: number };

export interface RegistryEntry {
  url: string;
  pageUrl: string;
  registeredAt: number;
  verdict?: Verdict;
}
