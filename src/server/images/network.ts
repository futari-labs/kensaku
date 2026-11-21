import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { isAllowedAddress } from "./address";
import type { FetchFailure, FetchResult, ImageFetchPort } from "./types";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** Sent on every upstream request, and nothing else: no cookie, credential, or Referer. */
export const UPSTREAM_ACCEPT = "image/avif,image/webp,image/png,image/jpeg";
const UPSTREAM_USER_AGENT = "Mozilla/5.0 (compatible; KensakuImageProxy/1.0)";

export interface PinnedResponse {
  status: number;
  location: string | undefined;
  body: AsyncIterable<Uint8Array>;
  /** Drops the connection; safe to call after the body ended. */
  close(): void;
}

/** Opens one GET to `url` on the connection to `address`. The layer below the address and port policy. */
export type Connect = (url: URL, address: string, signal: AbortSignal | undefined) => Promise<PinnedResponse>;

/**
 * Connects to `address` only. The `lookup` override answers every name with that address, so DNS
 * cannot change between the policy check and the connection. The Host header and TLS SNI keep the
 * URL's own hostname.
 */
export const connectPinned = (input: string | URL, address: string, signal?: AbortSignal): Promise<PinnedResponse> => {
  const url = new URL(input);
  const secure = url.protocol === "https:";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(address);
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
    else callback(null, address, family);
  };
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(
      {
        host,
        port: url.port === "" ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        lookup,
        ...(secure && !isIP(host) && { servername: host }),
        ...(signal && { signal }),
        headers: { Host: url.host, Accept: UPSTREAM_ACCEPT, "User-Agent": UPSTREAM_USER_AGENT, "Accept-Encoding": "identity", Connection: "close" },
      },
      (res) =>
        resolve({
          status: res.statusCode ?? 0,
          location: res.headers.location,
          body: res,
          close: () => res.destroy(),
        }),
    );
    request.on("error", reject);
    request.end();
  });
};

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface NetworkFetchOptions {
  /** Resolves a hostname to all of its addresses. Defaults to `dns.lookup({ all: true })`. */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  connect?: Connect;
}

/** Live-mode fetch: port and address policy, one resolution per hop, a pinned connection, at most 3 redirects. */
export class NetworkImageFetch implements ImageFetchPort {
  private readonly lookup: NonNullable<NetworkFetchOptions["lookup"]>;
  private readonly connect: Connect;

  constructor(options: NetworkFetchOptions = {}) {
    this.lookup = options.lookup ?? ((hostname) => dnsLookup(hostname, { all: true }));
    this.connect = options.connect ?? connectPinned;
  }

  async fetch(url: string, signal: AbortSignal): Promise<FetchResult> {
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      return { ok: false, reason: "blocked-address" };
    }
    for (let redirects = 0; ; redirects++) {
      const pinned = await this.pin(current);
      if (typeof pinned !== "string") return { ok: false, reason: pinned.failure };
      let response: PinnedResponse;
      try {
        response = await this.connect(current, pinned, signal);
      } catch {
        return { ok: false, reason: signal.aborted ? "timeout" : "network-error" };
      }
      try {
        if (REDIRECT_STATUSES.has(response.status) && response.location !== undefined) {
          if (redirects === MAX_REDIRECTS) return { ok: false, reason: "too-many-redirects" };
          try {
            current = new URL(response.location, current);
          } catch {
            return { ok: false, reason: "network-error" };
          }
          continue;
        }
        if (response.status !== 200) return { ok: false, reason: "upstream-status" };
        return await readBody(response.body, signal);
      } finally {
        response.close();
      }
    }
  }

  /** The address to connect to, or why this URL must not be fetched. */
  private async pin(url: URL): Promise<string | { failure: FetchFailure }> {
    if (url.protocol !== "http:" && url.protocol !== "https:") return { failure: "blocked-address" };
    if (!ALLOWED_PORTS.has(url.port)) return { failure: "blocked-port" };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: string[];
    if (isIP(host)) addresses = [host];
    else {
      try {
        addresses = (await this.lookup(host)).map((a) => a.address);
      } catch {
        return { failure: "network-error" };
      }
    }
    if (addresses.length === 0) return { failure: "network-error" };
    if (!addresses.every(isAllowedAddress)) return { failure: "blocked-address" };
    return addresses[0]!;
  }
}

async function readBody(body: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<FetchResult> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      total += chunk.length;
      if (total > MAX_IMAGE_BYTES) return { ok: false, reason: "too-large" };
      chunks.push(chunk);
    }
  } catch {
    return { ok: false, reason: signal.aborted ? "timeout" : "network-error" };
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}
