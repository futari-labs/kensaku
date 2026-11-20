import { serve } from "@hono/node-server";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { ConfigError, parseConfig } from "../../src/server/config";
import { harness } from "./helpers";

describe("parseConfig", () => {
  it("defaults to live mode on port 8787 with no key", () => {
    expect(parseConfig({})).toMatchObject({ mode: "live", port: 8787, dev: false, exaApiKey: undefined, answerMarketMode: "userLocation" });
  });

  it("accepts fixture mode only under NODE_ENV=test", () => {
    expect(parseConfig({ KENSAKU_EXA_MODE: "fixture", NODE_ENV: "test" }).mode).toBe("fixture");
    for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "development" }]) {
      expect(() => parseConfig({ KENSAKU_EXA_MODE: "fixture", ...env })).toThrow(ConfigError);
    }
  });

  it("drops the key in fixture mode, keeps it in live mode, and treats blanks as unset", () => {
    expect(parseConfig({ KENSAKU_EXA_MODE: "fixture", NODE_ENV: "test", EXA_API_KEY: "k" }).exaApiKey).toBeUndefined();
    expect(parseConfig({ EXA_API_KEY: "k" }).exaApiKey).toBe("k");
    expect(parseConfig({ EXA_API_KEY: " ", KENSAKU_EXA_MODE: " " })).toMatchObject({ mode: "live", exaApiKey: undefined });
  });

  it("rejects a bad mode or port, and reads the monthly limits", () => {
    expect(() => parseConfig({ KENSAKU_EXA_MODE: "mock" })).toThrow(ConfigError);
    expect(() => parseConfig({ KENSAKU_PORT: "80" })).toThrow(ConfigError);
    expect(parseConfig({ KENSAKU_MONTHLY_REQUEST_LIMIT: "10" }).limits.requestLimit).toBe(10);
  });
});

describe("Host and Origin guard", () => {
  const h = harness();
  const get = (headers: Record<string, string>) => h.app.request("/api/health", { headers });

  it("accepts 127.0.0.1:<port> and localhost:<port>", async () => {
    expect((await get({ host: "127.0.0.1:8787" })).status).toBe(200);
    expect((await get({ host: "localhost:8787" })).status).toBe(200);
  });

  it("rejects any other Host", async () => {
    for (const host of ["evil.example", "evil.example:8787", "127.0.0.1:5173", "127.0.0.1", "127.0.0.1.evil.example:8787"]) {
      expect((await get({ host })).status, host).toBe(403);
    }
  });

  it("rejects a foreign Origin on POST, allows a missing or own Origin, and ignores Origin on GET", async () => {
    const body = { messages: [{ role: "user", parts: [{ type: "text", text: "q" }] }], market: "XX" };
    const post = (origin?: string) => h.post(body, { headers: origin ? { origin } : {} });
    expect((await post("http://evil.example")).status).toBe(403);
    expect((await post("https://127.0.0.1:8787")).status).toBe(403);
    // 400: past the guard, rejected by the request parser (market XX).
    expect((await post()).status).toBe(400);
    expect((await post("http://127.0.0.1:8787")).status).toBe(400);
    expect((await get({ host: "127.0.0.1:8787", origin: "http://evil.example" })).status).toBe(200);
  });

  it("allows the Vite dev server's Host and Origin only under KENSAKU_DEV", async () => {
    const dev = (on: boolean) =>
      createApp({
        config: { mode: "fixture", dev: on, port: 8787, exaConfigured: false },
        ledger: h.store.ledger,
        clock: h.clock,
        log: () => {},
        portFor: () => {
          throw new Error("unused");
        },
      });
    const vite = { host: "127.0.0.1:5173", origin: "http://localhost:5173" };
    expect((await dev(true).request("/api/health", { headers: vite })).status).toBe(200);
    expect((await dev(false).request("/api/health", { headers: vite })).status).toBe(403);
    const post = (app: ReturnType<typeof dev>) =>
      app.request("/api/chat", { method: "POST", headers: { ...vite, "content-type": "application/json" }, body: "{}" });
    expect((await post(dev(true))).status).toBe(400);
    expect((await post(dev(false))).status).toBe(403);
  });
});

describe("Host guard over a real socket", () => {
  const raw = (port: number, head: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => socket.write(head));
      let reply = "";
      socket.on("data", (d) => (reply += d.toString()));
      socket.on("end", () => resolve(reply));
      socket.on("error", reject);
    });

  it("refuses a request with no Host header (HTTP/1.0) with 403, and still serves one with its own", async () => {
    const h = harness();
    const server = serve({ fetch: h.app.fetch, hostname: "127.0.0.1", port: 0 });
    await new Promise<void>((r) => server.once("listening", () => r()));
    try {
      const { port } = server.address() as net.AddressInfo;
      expect(await raw(port, "GET /api/health HTTP/1.0\r\n\r\n")).toMatch(/^HTTP\/1\.1 403/);
      expect(await raw(port, `GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:${port}\r\n\r\n`)).toMatch(/^HTTP\/1\.1 403/);
      expect(await raw(port, "GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:8787\r\n\r\n")).toMatch(/^HTTP\/1\.1 200/);
    } finally {
      server.close();
    }
  });
});
