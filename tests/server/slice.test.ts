// The v1.1 vertical slice through the real fixture runtime: market-aware offers, card content, image candidates, the proxy, and the CSP.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductResult, RunEvent } from "../../src/research/events";
import { toChunks } from "../../src/server/chat";
import { StoredMessageSchema } from "../../src/web/app/schemas";
import { loadHistory } from "../../src/web/app/storage";
import { runtimeApp } from "./runtime-app";
import { ofType, readChunks } from "./sse";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const productsOf = async (res: Response): Promise<ProductResult[]> => ofType(await readChunks(res), "data-products")[0]!.data;

describe("slice: xm5-sg-cards", () => {
  it("streams SGD offers first and one USD offer, with key specs, a resolved reason and image candidates per product", async () => {
    const products = await productsOf(await runtimeApp().chat("xm5-sg-cards", "SG"));
    expect(products.map((p) => p.candidate.brand)).toEqual(["Sony", "Breville"]);
    const [sony, breville] = products;
    expect(sony!.offerGroups.map((g) => [g.currency, g.offers.length])).toEqual([["SGD", 4], ["USD", 1]]);
    expect(sony!.keySpecs).toHaveLength(4);
    expect(sony!.reason).toMatchObject({ renderedText: expect.stringContaining("[1]"), truncated: false });
    expect(sony!.reason!.sources.length).toBeGreaterThan(0);
    expect(sony!.imageCandidates).toHaveLength(4);
    expect(breville!.imageCandidates).toHaveLength(2);
    for (const c of [...sony!.imageCandidates!, ...breville!.imageCandidates!]) {
      expect(c.id).toMatch(/^[0-9a-f]{64}$/);
      expect(c.sourceHost).not.toBe("");
      expect(c.sourceTitle).not.toBe("");
    }
  });

  it("never sends an image URL to the browser, and the raw candidate fields stay out of the candidate", async () => {
    const products = await productsOf(await runtimeApp().chat("xm5-sg-cards", "SG"));
    const wire = JSON.stringify(products);
    expect(wire).not.toMatch(/imgix\.net|\.jpg|\.png|\.webp/);
    for (const p of products) expect(Object.keys(p.candidate).sort()).toEqual(["brand", "modelIdentifiers", "name"]);
  });

  it("serves the candidates in order through /api/image/:id: the rule I3 failure first, then real images with the sniffed type", async () => {
    const r = runtimeApp();
    const [sony, breville] = await productsOf(await r.chat("xm5-sg-cards", "SG"));
    const statuses = async (ids: string[]) =>
      Promise.all(ids.map(async (id) => {
        const res = await r.get(`/api/image/${id}`, { "sec-fetch-site": "same-origin" });
        return [res.status, res.headers.get("content-type")] as const;
      }));
    expect(await statuses(sony!.imageCandidates!.map((c) => c.id))).toEqual([
      [422, "application/json"],
      [200, "image/jpeg"],
      [200, "image/png"],
      [200, "image/webp"],
    ]);
    expect(await statuses(breville!.imageCandidates!.map((c) => c.id))).toEqual([
      [422, "application/json"],
      [200, "image/png"],
    ]);
  });

  it("answers an unregistered id with 404 and sends the image policy, not the page policy, on every image response", async () => {
    const r = runtimeApp();
    const [sony] = await productsOf(await r.chat("xm5-sg-cards", "SG"));
    for (const id of [sony!.imageCandidates![1]!.id, "0".repeat(64)]) {
      const res = await r.get(`/api/image/${id}`, { "sec-fetch-site": "same-origin" });
      expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    }
    expect((await r.get(`/api/image/${"0".repeat(64)}`, { "sec-fetch-site": "same-origin" })).status).toBe(404);
  });
});

describe("slice: xm5-us-cards", () => {
  it("is a US run with USD offers and image candidates for both products", async () => {
    const products = await productsOf(await runtimeApp().chat("xm5-us-cards", "US"));
    expect(products.map((p) => p.offerGroups.map((g) => g.currency))).toEqual([["USD"], ["USD"]]);
    expect(products.map((p) => p.imageCandidates!.length)).toEqual([2, 2]);
  });
});

describe("slice: the CSP", () => {
  const POLICY =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

  it("is on every response except /api/image/:id: pages, API replies, the stream, errors and the guard's 403", async () => {
    const r = runtimeApp();
    const replies = [
      await r.get("/"),
      await r.get("/index.html"),
      await r.get("/api/health"),
      await r.get("/api/usage"),
      await r.get("/api/nothing"),
      await r.get("/no/such/page"),
      await r.get("/api/health", { host: "evil.example:8787" }),
      await r.chat("xm5-us"),
      await r.chat("no-such-scenario"),
    ];
    expect(replies.map((res) => res.headers.get("content-security-policy"))).toEqual(replies.map(() => POLICY));
    await replies[7]!.text();
  });
});

describe("slice: the comparison cut reaches the stream", () => {
  const sources = [{ sourceId: "1", url: "https://review.example/a" }];
  const month = () => ({ monthRequests: 0, monthLimit: 400 });

  it("a cut comparison streams its text and a truncated notice; a dropped one streams only the notice; a clean one streams neither", () => {
    const types = (event: RunEvent) => toChunks(event, month).map((c) => c.type);
    expect(types({ type: "comparison", text: "Good [1].", truncated: true, sources })).toEqual(["text-start", "text-delta", "text-end", "source-url", "data-comparison"]);
    expect(types({ type: "comparison", text: null, truncated: true, sources: [] })).toEqual(["data-comparison"]);
    expect(types({ type: "comparison", text: "Good [1].", truncated: false, sources })).toEqual(["text-start", "text-delta", "text-end", "source-url"]);
  });
});

describe("slice: stored history", () => {
  it("the frozen MVP history payload still validates, without any of the new product fields", () => {
    const frozen = JSON.parse(readFileSync(join(import.meta.dirname, "../../evals/fixtures/history/mvp-history-xm5-sg.json"), "utf8")) as { key: string; value: string };
    const store = new Map([[frozen.key, frozen.value]]);
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) } });
    const { messages, notice } = loadHistory();
    expect(notice).toBeUndefined();
    expect(messages.length).toBeGreaterThan(1);
    const products = messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "data-products" ? p.data : [])));
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) expect(p).not.toHaveProperty("imageCandidates");
  });
});

describe("slice: the reason keeps its marker numbers to the page", () => {
  const product = (reason: object) => ({
    id: "m", role: "assistant",
    parts: [{ type: "data-products", data: [{ candidate: { name: "n", brand: "b", modelIdentifiers: [] }, offerGroups: [], evidence: [], rejectedCounts: { "irrelevant-product": 0, "unsupported-currency": 0, "url-not-from-run": 0, "invalid-url": 0 }, reason }] }],
  });
  const reason = { renderedText: "Good [4].", sources: ["https://r.example/a"], unresolvedMarkers: 0, uncitedParagraphs: [], truncated: false };

  it("validates citedSources and rejects a reason without them", () => {
    expect(StoredMessageSchema.safeParse(product({ ...reason, citedSources: [{ url: "https://r.example/a", numbers: [4] }] })).success).toBe(true);
    expect(StoredMessageSchema.safeParse(product(reason)).success).toBe(false);
  });
});
