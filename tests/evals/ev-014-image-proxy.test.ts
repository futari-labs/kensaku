import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectPinned, NetworkImageFetch } from "../../src/server/images";
import { UPSTREAM_ACCEPT } from "../../src/server/images/network";
import type { ImageFetchPort } from "../../src/server/images";
import { TEST_EXA_KEY } from "../fixtures/test-key";
import { DAY, fakeConnect, fixture, isolated, proxyHarness, PUBLIC_IP, recordingPort } from "../server/images/helpers";

const MIB = 1024 * 1024;
const JPG = "ok-400x300.jpg";
const SAFE = { corp: "same-origin", nosniff: "nosniff", csp: "default-src 'none'" };
const publicLookup = () => Promise.resolve([{ address: PUBLIC_IP, family: 4 }]);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("EV-014 image proxy", () => {
  it("1. an unknown or malformed id gets 404 and no outbound request", async () => {
    const { port, calls } = recordingPort({ "https://cdn.example.com/a.jpg": fixture(JPG) });
    const h = proxyHarness({ port });
    h.register("https://cdn.example.com/a.jpg");
    const ids = ["f".repeat(64), "A".repeat(64), "abc", "g".repeat(64), "f".repeat(65), `${"a".repeat(63)}%2e`];
    for (const id of ids) {
      const res = await h.get(id);
      expect(res.status, id).toBe(404);
      expect(isolated(res).corp).toBe("same-origin");
    }
    expect(calls).toEqual([]);
  });

  describe("2. blocked addresses (policy layer)", () => {
    const blocked = [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.2.1",
      "::1", "::", "fc00::1", "fe80::1", "fec0::1", "ff02::1", "::ffff:127.0.0.1", "::127.0.0.1", "64:ff9b::7f00:1",
      "2001::1", "2002:7f00:1::1", "2001:db8::1",
    ];
    it.each(blocked)("%s gets 502 and no connection", async (address) => {
      const { connect, calls } = fakeConnect({});
      const lookup = vi.fn(() => Promise.resolve([{ address, family: address.includes(":") ? 6 : 4 }]));
      const h = proxyHarness({ port: new NetworkImageFetch({ lookup, connect }) });
      const res = await h.get(h.register("https://cdn.example.com/a.jpg"));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "blocked-address" });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([]);
    });

    it("refuses a host when any one of its addresses is blocked, and allows a public one", async () => {
      const { connect, calls } = fakeConnect({ "https://cdn.example.com/ok.jpg": { status: 200, body: fixture(JPG) } });
      const mixed = vi.fn(() => Promise.resolve([{ address: PUBLIC_IP, family: 4 }, { address: "10.0.0.1", family: 4 }]));
      const h = proxyHarness({ port: new NetworkImageFetch({ lookup: mixed, connect }) });
      expect((await h.get(h.register("https://cdn.example.com/a.jpg"))).status).toBe(502);
      const open = proxyHarness({ port: new NetworkImageFetch({ lookup: publicLookup, connect }) });
      expect((await open.get(open.register("https://cdn.example.com/ok.jpg"))).status).toBe(200);
      expect(calls.map((c) => c.address)).toEqual([PUBLIC_IP]);
    });
  });

  describe("3. literal hosts and ports (policy layer)", () => {
    it.each(["http://127.0.0.1/a.jpg", "http://[::1]/a.jpg", "http://2130706433/a.jpg", "http://0x7f.1/a.jpg"])("%s gets 502 without a lookup or a connection", async (url) => {
      const { connect, calls } = fakeConnect({});
      const lookup = vi.fn(publicLookup);
      const h = proxyHarness({ port: new NetworkImageFetch({ lookup, connect }) });
      expect((await h.get(h.register(url))).status).toBe(502);
      expect(lookup).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });

    it("localhost resolved to 127.0.0.1 gets 502", async () => {
      const { connect, calls } = fakeConnect({});
      const lookup = vi.fn(() => Promise.resolve([{ address: "127.0.0.1", family: 4 }]));
      const h = proxyHarness({ port: new NetworkImageFetch({ lookup, connect }) });
      expect((await h.get(h.register("http://localhost/a.jpg"))).status).toBe(502);
      expect(lookup).toHaveBeenCalledWith("localhost");
      expect(calls).toEqual([]);
    });

    it.each(["https://cdn.example.com:8443/a.jpg", "http://cdn.example.com:22/a.jpg"])("%s gets 502 on the port", async (url) => {
      const { connect, calls } = fakeConnect({});
      const h = proxyHarness({ port: new NetworkImageFetch({ lookup: publicLookup, connect }) });
      const res = await h.get(h.register(url));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "blocked-port" });
      expect(calls).toEqual([]);
    });
  });

  describe("4. redirects", () => {
    const image = fixture(JPG);
    const hop = (n: number) => `https://cdn.example.com/r${n}.jpg`;
    const chain = (redirects: number) =>
      Object.fromEntries([
        ...Array.from({ length: redirects }, (_, i) => [hop(i), { status: 302, location: hop(i + 1) }] as const),
        [hop(redirects), { status: 200, body: image }] as const,
      ]);

    it("a public host that redirects to a private address gets 502, for a literal and for a name", async () => {
      for (const target of ["http://10.0.0.5/a.jpg", "https://internal.example/a.jpg"]) {
        const { connect, calls } = fakeConnect({ [hop(0)]: { status: 302, location: target } });
        const lookup = vi.fn((host: string) => Promise.resolve([{ address: host === "internal.example" ? "10.0.0.5" : PUBLIC_IP, family: 4 }]));
        const h = proxyHarness({ port: new NetworkImageFetch({ lookup, connect }) });
        const res = await h.get(h.register(hop(0)));
        expect(res.status, target).toBe(502);
        expect(calls.map((c) => c.url)).toEqual([hop(0)]);
      }
    });

    it("a chain of 4 redirects gets 502", async () => {
      const { connect } = fakeConnect(chain(4));
      const h = proxyHarness({ port: new NetworkImageFetch({ lookup: publicLookup, connect }) });
      const res = await h.get(h.register(hop(0)));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "too-many-redirects" });
    });

    it("a chain of 3 public redirects to a valid image succeeds", async () => {
      const { connect, calls } = fakeConnect(chain(3));
      const h = proxyHarness({ port: new NetworkImageFetch({ lookup: publicLookup, connect }) });
      const res = await h.get(h.register(hop(0)));
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(4);
    });
  });

  it("5. the request goes to the first resolved public address; a later private answer is never used", async () => {
    const { connect, calls } = fakeConnect({ "https://cdn.example.com/a.jpg": { status: 200, body: fixture(JPG) } });
    const answers = [[{ address: PUBLIC_IP, family: 4 }], [{ address: "127.0.0.1", family: 4 }]];
    const lookup = vi.fn(() => Promise.resolve(answers.shift()!));
    const h = proxyHarness({ port: new NetworkImageFetch({ lookup, connect }) });
    expect((await h.get(h.register("https://cdn.example.com/a.jpg"))).status).toBe(200);
    expect(calls).toEqual([{ url: "https://cdn.example.com/a.jpg", address: PUBLIC_IP }]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  describe("6 and 7. connector level", () => {
    const serve = async (handler: http.RequestListener) => {
      const server = http.createServer(handler);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return { server, port: (server.address() as AddressInfo).port };
    };
    const readAll = async (body: AsyncIterable<Uint8Array>) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) chunks.push(chunk);
      return Buffer.concat(chunks);
    };

    it("connectPinned reaches the given address with the original Host and no DNS lookup", async () => {
      const seen: http.IncomingHttpHeaders[] = [];
      const { server, port } = await serve((req, res) => {
        seen.push(req.headers);
        res.end("pinned");
      });
      const lookup = vi.spyOn(dns, "lookup");
      const lookupAsync = vi.spyOn(dns.promises, "lookup");
      try {
        const response = await connectPinned(`http://img.invalid:${port}/a.jpg?x=1`, "127.0.0.1");
        expect(response.status).toBe(200);
        expect((await readAll(response.body)).toString()).toBe("pinned");
        expect(seen).toHaveLength(1);
        expect(seen[0]!.host).toBe(`img.invalid:${port}`);
        expect(lookup).not.toHaveBeenCalled();
        expect(lookupAsync).not.toHaveBeenCalled();
      } finally {
        server.close();
      }
    });

    it("7. the upstream request has no Cookie, Authorization, or Referer, and the exact Accept", async () => {
      const seen: http.IncomingHttpHeaders[] = [];
      const { server, port } = await serve((req, res) => {
        seen.push(req.headers);
        res.end("x");
      });
      try {
        const response = await connectPinned(`http://img.invalid:${port}/a.jpg`, "127.0.0.1");
        await readAll(response.body);
        const headers = seen[0]!;
        for (const name of ["cookie", "authorization", "referer", "proxy-authorization"]) expect(headers[name], name).toBeUndefined();
        expect(headers.accept).toBe(UPSTREAM_ACCEPT);
        expect(typeof headers["user-agent"]).toBe("string");
      } finally {
        server.close();
      }
    });
  });

  describe("8. limits", () => {
    it("bytes over 5 MiB get 502 and reading stops at the limit", async () => {
      let yielded = 0;
      const connect = () =>
        Promise.resolve({
          status: 200,
          location: undefined,
          body: (async function* () {
            for (;;) {
              yielded++;
              yield new Uint8Array(MIB);
            }
          })(),
          close: () => undefined,
        });
      const h = proxyHarness({ port: new NetworkImageFetch({ lookup: publicLookup, connect }) });
      const res = await h.get(h.register("https://cdn.example.com/big.jpg"));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "too-large" });
      expect(yielded).toBe(6);
    });

    it("an upstream that never finishes gets 502 within 8.5 s", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let aborted = false;
      const port: ImageFetchPort = {
        fetch: (_url, signal) => {
          signal.addEventListener("abort", () => (aborted = true));
          return new Promise(() => undefined);
        },
      };
      const h = proxyHarness({ port });
      const pending = h.get(h.register("https://cdn.example.com/slow.jpg"));
      await vi.advanceTimersByTimeAsync(8_500);
      const res = await pending;
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "timeout" });
      expect(aborted).toBe(true);
    });
  });

  describe("9. served images and validation", () => {
    const served = [
      ["ok-400x300.jpg", "image/jpeg"],
      ["ok-400x300.png", "image/png"],
      ["ok-400x300.webp", "image/webp"],
      ["ok-400x300.avif", "image/avif"],
    ] as const;

    it.each(served)("%s is served as %s with the safety headers, ignoring the upstream's headers", async (file, type) => {
      const bytes = fixture(file);
      const upstream = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "session=abc", "X-Upstream": "1" });
        res.end(bytes);
      });
      await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
      const upstreamPort = (upstream.address() as AddressInfo).port;
      try {
        // Real HTTP to a local server, behind the policy layer: the name resolves to a public address, the connection goes to loopback.
        const connect = (url: URL, _address: string, signal: AbortSignal | undefined) =>
          connectPinned(`http://${url.hostname}:${upstreamPort}${url.pathname}`, "127.0.0.1", signal);
        const h = proxyHarness({ port: new NetworkImageFetch({ lookup: publicLookup, connect }) });
        const res = await h.get(h.register(`http://img.example/${file}`));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe(type);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
        expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        expect(res.headers.get("cache-control")).toBe("private, max-age=604800");
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(res.headers.get("x-upstream")).toBeNull();
        expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
      } finally {
        upstream.close();
      }
    });

    it.each([
      ["fail-1x1.gif", "unsupported-type"],
      ["fail-doc.svg", "unsupported-type"],
      ["fail-150x400.png", "too-small"],
      ["fail-1200x630.webp", "aspect"],
    ])("%s gets 422 (%s)", async (file, reason) => {
      const { port } = recordingPort({ "https://cdn.example.com/x": fixture(file) });
      const h = proxyHarness({ port });
      const res = await h.get(h.register("https://cdn.example.com/x"));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: reason });
      expect(isolated(res)).toEqual({ corp: "same-origin", nosniff: "nosniff", csp: "default-src 'none'" });
    });
  });

  it("10. cross-site requests get 403 with no upstream request; same-origin, no header, and a foreign Host behave as specified", async () => {
    const { port, calls } = recordingPort({ "https://cdn.example.com/a.jpg": fixture(JPG) });
    const h = proxyHarness({ port });
    const id = h.register("https://cdn.example.com/a.jpg");
    for (const site of ["cross-site", "same-site", "none"]) {
      const res = await h.get(id, { "sec-fetch-site": site });
      expect(res.status, site).toBe(403);
      expect(isolated(res).corp).toBe("same-origin");
    }
    expect(calls).toEqual([]);
    expect((await h.get(id, { "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await h.get(id)).status).toBe(200);
    const foreign = await h.get(id, { host: "evil.example" });
    expect(foreign.status).toBe(403);
    expect(isolated(foreign)).toEqual(SAFE);
  });

  it("10b. every response on an image path carries the security headers, including the guard's 403 and the catch-all 404", async () => {
    const h = proxyHarness({ port: recordingPort().port });
    for (const path of ["/api/image", "/api/image/", `/api/image/${"a".repeat(64)}/x`, "/api/image/abc"]) {
      const res = await h.app.request(path, { headers: { host: "127.0.0.1:8787" } });
      expect(res.status, path).toBe(404);
      expect(isolated(res), path).toEqual(SAFE);
      const foreign = await h.app.request(path, { headers: { host: "evil.example" } });
      expect(foreign.status, path).toBe(403);
      expect(isolated(foreign), path).toEqual(SAFE);
    }
    expect(isolated(await h.app.request("/api/health", { headers: { host: "127.0.0.1:8787" } })).corp).toBeNull();
  });

  describe("11. cache lifecycle (fake clock)", () => {
    it("serves accepted bytes from disk for 7 days, then refetches", async () => {
      const { port, calls } = recordingPort({ "https://cdn.example.com/a.jpg": fixture(JPG) });
      const h = proxyHarness({ port });
      const id = h.register("https://cdn.example.com/a.jpg");
      expect((await h.get(id)).status).toBe(200);
      h.clock.advance(7 * DAY - 1000);
      expect((await h.get(id)).status).toBe(200);
      expect(calls).toHaveLength(1);
      h.clock.advance(2000);
      expect((await h.get(id)).status).toBe(200);
      expect(calls).toHaveLength(2);
    });

    it("reuses a 422 for 24 hours and a 502 for 10 minutes", async () => {
      const { port, calls } = recordingPort({ "https://cdn.example.com/small.png": fixture("fail-150x400.png") });
      const h = proxyHarness({ port });
      const small = h.register("https://cdn.example.com/small.png");
      const down = h.register("https://cdn.example.com/down.jpg");
      expect((await h.get(small)).status).toBe(422);
      expect((await h.get(down)).status).toBe(502);
      expect(calls).toHaveLength(2);
      h.clock.advance(9 * 60_000);
      expect([(await h.get(small)).status, (await h.get(down)).status]).toEqual([422, 502]);
      expect(calls).toHaveLength(2);
      h.clock.advance(2 * 60_000);
      expect((await h.get(down)).status).toBe(502);
      expect(calls).toHaveLength(3);
      h.clock.advance(24 * 3_600_000 - 11 * 60_000 - 1000);
      expect((await h.get(small)).status).toBe(422);
      expect(calls).toHaveLength(3);
      h.clock.advance(2000);
      expect((await h.get(small)).status).toBe(422);
      expect(calls).toHaveLength(4);
    });

    it("prunes an entry registered 31 days ago at startup, and keeps one registered 29 days ago", async () => {
      const { port } = recordingPort({ "https://cdn.example.com/a.jpg": fixture(JPG), "https://cdn.example.com/b.jpg": fixture(JPG) });
      const h = proxyHarness({ port });
      const old = h.register("https://cdn.example.com/a.jpg");
      expect((await h.get(old)).status).toBe(200);
      h.clock.advance(2 * DAY);
      const recent = h.register("https://cdn.example.com/b.jpg");
      h.clock.advance(29 * DAY);
      const restarted = h.restart();
      expect((await restarted.get(old)).status).toBe(404);
      expect(readdirSync(restarted.dir).filter((f) => f.startsWith(old))).toEqual([]);
      expect((await restarted.get(recent)).status).toBe(200);
    });

    it("evicts the oldest bytes first when over the cap, and refetches them on demand", async () => {
      const urls = [1, 2, 3].map((n) => `https://cdn.example.com/${n}.png`);
      const bytes = fixture("ok-400x300.png");
      const { port, calls } = recordingPort(Object.fromEntries(urls.map((u) => [u, bytes])));
      const h = proxyHarness({ port, maxCacheBytes: bytes.length * 2 + 10 });
      const ids = urls.map((u) => h.register(u));
      for (const id of ids) {
        expect((await h.get(id)).status).toBe(200);
        h.clock.advance(1000);
      }
      expect(calls).toHaveLength(3);
      h.register("https://cdn.example.com/4.png");
      expect(readdirSync(h.dir).filter((f) => f.endsWith(".bin")).sort()).toEqual([`${ids[1]}.bin`, `${ids[2]}.bin`].sort());
      expect((await h.get(ids[1]!)).status).toBe(200);
      expect((await h.get(ids[2]!)).status).toBe(200);
      expect(calls).toHaveLength(3);
      expect((await h.get(ids[0]!)).status).toBe(200);
      expect(calls).toHaveLength(4);
    });
  });

  describe("12. concurrency", () => {
    it("10 simultaneous requests for one id cause one upstream request", async () => {
      let count = 0;
      const port: ImageFetchPort = {
        fetch: async () => {
          count++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { ok: true, bytes: fixture(JPG) };
        },
      };
      const h = proxyHarness({ port });
      const id = h.register("https://cdn.example.com/a.jpg");
      const responses = await Promise.all(Array.from({ length: 10 }, () => h.get(id)));
      expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(count).toBe(1);
    });

    it("10 different ids never have more than 4 upstream requests in flight", async () => {
      let inFlight = 0;
      let peak = 0;
      const port: ImageFetchPort = {
        fetch: async () => {
          peak = Math.max(peak, ++inFlight);
          await new Promise((resolve) => setTimeout(resolve, 20));
          inFlight--;
          return { ok: true, bytes: fixture(JPG) };
        },
      };
      const h = proxyHarness({ port });
      const ids = Array.from({ length: 10 }, (_, n) => h.register(`https://cdn.example.com/${n}.jpg`));
      const responses = await Promise.all(ids.map((id) => h.get(id)));
      expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(peak).toBe(4);
    });
  });

  describe("13. hygiene", () => {
    it("registration stores only url, pageUrl, and registeredAt; serving touches no Exa budget or ledger", async () => {
      const { port } = recordingPort({ "https://cdn.example.com/a.jpg": fixture(JPG) });
      const h = proxyHarness({ port });
      const before = h.usage();
      const id = h.register("https://cdn.example.com/a.jpg");
      const entries = () => readdirSync(h.dir).filter((f) => f.endsWith(".json"));
      expect(Object.keys(JSON.parse(readFileSync(join(h.dir, entries()[0]!), "utf8"))).sort()).toEqual(["pageUrl", "registeredAt", "url"]);
      expect((await h.get(id)).status).toBe(200);
      for (const file of readdirSync(h.dir).filter((f) => f.endsWith(".json"))) {
        const text = readFileSync(join(h.dir, file), "utf8").toLowerCase();
        for (const word of ["authorization", "cookie", "referer", "bearer", TEST_EXA_KEY]) expect(text).not.toContain(word);
      }
      expect(h.usage()).toEqual(before);
    });

    it("logs one JSON line per fetch without the query string", async () => {
      const { port } = recordingPort({ "https://cdn.example.com/a.jpg?token=secret": fixture(JPG) });
      const h = proxyHarness({ port });
      const id = h.register("https://cdn.example.com/a.jpg?token=secret");
      await h.get(id);
      await h.get(id);
      expect(h.logs).toHaveLength(1);
      expect(h.logs[0]).toMatchObject({ event: "image_fetch", id, host: "cdn.example.com", verdict: "ok", bytes: fixture(JPG).length });
      expect(JSON.stringify(h.logs)).not.toContain("secret");
    });

    it("the proxy imports no Exa module, by relative path, alias, or package", () => {
      const dir = join(import.meta.dirname, "../../src/server");
      const files = [join(dir, "images.ts"), ...readdirSync(join(dir, "images")).map((f) => join(dir, "images", f))];
      const specifier = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
      const exa = /(^|\/)exa(\/|$)|^@\/exa|exa-js/;
      for (const file of files) {
        const imported = [...readFileSync(file, "utf8").matchAll(specifier)].map((m) => m[1]!);
        expect(imported.filter((spec) => exa.test(spec)), file).toEqual([]);
      }
      for (const spec of ["../exa/port", "../../exa/budget", "@/exa/client", "exa-js", "../exa"]) expect(exa.test(spec), spec).toBe(true);
      for (const spec of ["node:net", "../core", "./example", "../core/url"]) expect(exa.test(spec), spec).toBe(false);
    });
  });

  describe("14. unexpected input never escapes the security headers", () => {
    it.each(["not a url", "http://", "https://exa mple.com/a.jpg", "ftp://cdn.example.com/a.jpg", "javascript:alert(1)"])(
      "registered %j gets 502 invalid-url with the headers, and one log line",
      async (url) => {
        const { connect, calls } = fakeConnect({});
        const lookup = vi.fn(publicLookup);
        const h = proxyHarness({ port: new NetworkImageFetch({ lookup, connect }) });
        const id = h.register(url);
        const res = await h.get(id);
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: "invalid-url" });
        expect(isolated(res)).toEqual(SAFE);
        expect(h.logs).toHaveLength(1);
        expect(h.logs[0]).toMatchObject({ event: "image_fetch", id, verdict: "invalid-url" });
        expect(lookup).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
      },
    );

    it("an unparseable page URL registers with an empty source host", () => {
      const h = proxyHarness({ port: recordingPort().port });
      const [first] = h.proxy.registerImageCandidates([{ imageUrl: "https://cdn.example.com/a.jpg", pageUrl: "::nope::", sourceTitle: "T" }]);
      expect(first?.sourceHost).toBe("");
    });

    it("any unexpected error in serving becomes the standard 502 with the headers", async () => {
      const { port } = recordingPort({ "https://cdn.example.com/a.jpg": fixture(JPG) });
      const h = proxyHarness({ port });
      const id = h.register("https://cdn.example.com/a.jpg");
      const broken = proxyHarness({ port, dir: h.dir, clock: h.clock, log: () => { throw new Error("log sink failed"); } });
      const res = await broken.get(id);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "network-error" });
      expect(isolated(res)).toEqual(SAFE);
    });
  });

  describe("15. orphan temp files", () => {
    it("are deleted at startup, and the cache's real files stay", async () => {
      const { port } = recordingPort({ "https://cdn.example.com/a.jpg": fixture(JPG) });
      const h = proxyHarness({ port });
      const id = h.register("https://cdn.example.com/a.jpg");
      expect((await h.get(id)).status).toBe(200);
      for (const name of [`${id}.json.123.tmp`, `${id}.bin.456.tmp`, "stray.tmp"]) writeFileSync(join(h.dir, name), "partial");
      const restarted = h.restart();
      expect(readdirSync(restarted.dir).sort()).toEqual([`${id}.bin`, `${id}.json`].sort());
      expect((await restarted.get(id)).status).toBe(200);
      expect(restarted.logs).toEqual([]);
    });
  });

  it("serves a candidate list for registered sources", () => {
    const h = proxyHarness({ port: recordingPort().port });
    const [first] = h.proxy.registerImageCandidates([{ imageUrl: "https://cdn.example.com/a.jpg", pageUrl: "https://www.shop.example/p", sourceTitle: "Thing" }]);
    expect(first).toEqual({ id: expect.stringMatching(/^[0-9a-f]{64}$/), sourceHost: "shop.example", sourceTitle: "Thing" });
  });
});
