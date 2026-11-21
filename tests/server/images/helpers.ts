import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../../src/server/app";
import { ImageProxy } from "../../../src/server/images";
import type { Connect, ImageFetchPort, FetchResult, PinnedResponse } from "../../../src/server/images";
import { fakeClock, storage, tempDir } from "../../exa/helpers";

export const fixture = (name: string): Uint8Array => readFileSync(join(import.meta.dirname, "../../fixtures/images", name));

export const PAGE = "https://shop.example/p/1";
export const PUBLIC_IP = "93.184.216.34";
export const START = "2026-11-21T10:00:00Z";
export const DAY = 86_400_000;

export interface ProxyHarness {
  app: ReturnType<typeof createApp>;
  proxy: ImageProxy;
  dir: string;
  clock: ReturnType<typeof fakeClock>;
  logs: Record<string, unknown>[];
  ledger: ReturnType<typeof storage>["ledger"];
  usage: () => { requests: number; costDollars: number };
  /** Registers an image URL for this run and returns its id. */
  register: (imageUrl: string) => string;
  get: (id: string, headers?: Record<string, string>) => Promise<Response>;
  /** A second proxy and app over the same directory, as after a server restart. */
  restart: () => ProxyHarness;
}

export function proxyHarness(options: { port: ImageFetchPort; maxCacheBytes?: number; dir?: string; clock?: ReturnType<typeof fakeClock> }): ProxyHarness {
  const clock = options.clock ?? fakeClock(START);
  const store = storage(clock);
  const dir = options.dir ?? join(tempDir(), "images");
  const logs: Record<string, unknown>[] = [];
  const log = (line: Record<string, unknown>) => void logs.push(line);
  const proxy = new ImageProxy({ port: options.port, clock, log, dir, ...(options.maxCacheBytes !== undefined && { maxCacheBytes: options.maxCacheBytes }) });
  const app = createApp({
    config: { mode: "fixture", dev: false, port: 8787, exaConfigured: false },
    portFor: () => {
      throw new Error("no Exa port in the image tests");
    },
    ledger: store.ledger,
    clock,
    log,
    images: proxy,
  });
  const harness: ProxyHarness = {
    app,
    proxy,
    dir,
    clock,
    logs,
    ledger: store.ledger,
    usage: () => store.usage(),
    register: (imageUrl) => proxy.registerImageCandidates([{ imageUrl, pageUrl: PAGE, sourceTitle: "Product" }])[0]!.id,
    get: (id, headers = {}) => Promise.resolve(app.request(`/api/image/${id}`, { headers: { host: "127.0.0.1:8787", ...headers } })),
    restart: () => proxyHarness({ ...options, dir, clock }),
  };
  return harness;
}

/** A port that answers each URL from `routes` and records every call. A URL not in `routes` is an upstream 404. */
export function recordingPort(routes: Record<string, Uint8Array> = {}) {
  const calls: string[] = [];
  let next: (url: string) => FetchResult = (url) => (routes[url] ? { ok: true, bytes: routes[url] } : { ok: false, reason: "upstream-status" });
  const port: ImageFetchPort = {
    fetch: (url) => {
      calls.push(url);
      return Promise.resolve(next(url));
    },
  };
  return { port, calls, respondWith: (fn: (url: string) => FetchResult) => void (next = fn) };
}

export const bytesBody = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes;
  })();

export interface FakeRoute {
  status: number;
  location?: string;
  body?: Uint8Array;
}

/** A `Connect` that answers from `routes` (keyed by the full URL) and records each URL and pinned address. */
export function fakeConnect(routes: Record<string, FakeRoute>) {
  const calls: { url: string; address: string }[] = [];
  const connect: Connect = (url, address) => {
    calls.push({ url: url.href, address });
    const route = routes[url.href];
    const response: PinnedResponse = {
      status: route?.status ?? 404,
      location: route?.location,
      body: bytesBody(route?.body ?? new Uint8Array()),
      close: () => undefined,
    };
    return Promise.resolve(response);
  };
  return { connect, calls };
}

export const isolated = (res: Response) => ({
  corp: res.headers.get("cross-origin-resource-policy"),
  nosniff: res.headers.get("x-content-type-options"),
  csp: res.headers.get("content-security-policy"),
});
