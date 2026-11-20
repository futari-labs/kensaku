// EV-006 Streaming and failure states: the real Hono app over FixtureExaPort scenarios.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STAGES } from "../../src/research/events";
import { ExaSdkPort } from "../../src/exa/sdk-port";
import { fakeClient, HttpError } from "../exa/helpers";
import { harness } from "../server/helpers";
import { ofType, parseSse, readChunks } from "../server/sse";
import type { Chunk } from "../server/sse";

const progressOf = (chunks: Chunk[]) => ofType(chunks, "data-progress").map((c) => `${c.data.stage}:${c.data.status}`);

/** Stage order: running comes first for each stage, then done or failed, and stages never go backwards. */
function expectOrderedProgress(chunks: Chunk[]) {
  const seen = ofType(chunks, "data-progress").map((c) => c.data);
  let last = -1;
  const running = new Set<string>();
  for (const p of seen) {
    const index = STAGES.indexOf(p.stage);
    expect(index).toBeGreaterThanOrEqual(last);
    last = index;
    if (p.status === "running") running.add(p.stage);
    else expect(running.has(p.stage)).toBe(true);
  }
}

const terminalCount = (chunks: Chunk[]) => ofType(chunks, "finish").length;

interface Case {
  scenario: string;
  error?: { kind: string; partial: boolean };
  /** Progress entries that must appear, in order. */
  progress: string[];
}

const ALL_DONE = STAGES.flatMap((s) => [`${s}:running`, `${s}:done`]);

const cases: Case[] = [
  { scenario: "xm5-us", progress: ALL_DONE },
  { scenario: "no-candidates", progress: ALL_DONE },
  { scenario: "no-offers", progress: ALL_DONE },
  { scenario: "error-401", error: { kind: "auth", partial: false }, progress: ["candidates:running", "candidates:failed"] },
  { scenario: "error-402", error: { kind: "credits_exhausted", partial: false }, progress: ["candidates:running", "candidates:failed"] },
  { scenario: "error-429", error: { kind: "rate_limited", partial: false }, progress: ["candidates:running", "candidates:failed"] },
  { scenario: "error-500", error: { kind: "upstream", partial: false }, progress: ["candidates:running", "candidates:failed"] },
  { scenario: "error-timeout", error: { kind: "timeout", partial: false }, progress: ["candidates:running", "candidates:failed"] },
  {
    scenario: "error-offers",
    error: { kind: "upstream", partial: true },
    progress: ["candidates:running", "candidates:done", "offers:running", "offers:failed"],
  },
];

describe("EV-006 scenarios", () => {
  it.each(cases)("$scenario: ordered progress, one terminal state, expected error", async ({ scenario, error, progress }) => {
    const h = harness();
    const res = await h.chat(scenario);
    expect(res.status).toBe(200);
    const chunks = await readChunks(res);

    expect(progressOf(chunks)).toEqual(progress);
    expectOrderedProgress(chunks);
    expect(terminalCount(chunks)).toBe(1);
    expect(chunks.at(-1)!.type).toBe("finish");

    const errors = ofType(chunks, "data-error");
    if (error) {
      expect(errors).toHaveLength(1);
      expect(errors[0]!.data).toMatchObject(error);
    } else {
      expect(errors).toHaveLength(0);
    }
  });

  it("success: comparison, sources, offers, and usage are streamed", async () => {
    const chunks = await readChunks(await harness().chat("xm5-us"));
    expect(ofType(chunks, "text-delta")).toHaveLength(1);
    expect(ofType(chunks, "source-url").length).toBeGreaterThan(0);
    const [products] = ofType(chunks, "data-products");
    const first = products!.data[0]!;
    expect(first.offerGroups[0]!.offers.length).toBeGreaterThan(0);
    expect(ofType(chunks, "data-usage")[0]!.data).toMatchObject({ exaRequests: 2, cacheHits: 0, monthRequests: 2, monthLimit: 400 });
  });

  it("no candidates completes with the comparison and no products; no offers completes with an empty offer list", async () => {
    const none = await readChunks(await harness().chat("no-candidates"));
    expect(ofType(none, "data-products")[0]!.data).toEqual([]);
    expect(ofType(none, "text-delta")).toHaveLength(1);
    const noOffers = await readChunks(await harness().chat("no-offers"));
    const product = ofType(noOffers, "data-products")[0]!.data[0]!;
    expect(product.offerGroups).toEqual([]);
  });

  it("a failure after the candidates stage keeps the validated products and the comparison, marked partial", async () => {
    const chunks = await readChunks(await harness().chat("error-offers"));
    expect(ofType(chunks, "data-products")).toHaveLength(1);
    expect(ofType(chunks, "text-delta")).toHaveLength(1);
    expect(ofType(chunks, "data-error")[0]!.data).toMatchObject({ partial: true });
  });

  it("releases the run lock after every scenario, so the next request succeeds", async () => {
    const h = harness();
    for (const { scenario } of cases) {
      await readChunks(await h.chat(scenario));
      // A 402 marks the month exhausted and blocks live calls until the owner deletes the ledger (ARCHITECTURE).
      rmSync(join(h.store.root, "ledger"), { recursive: true, force: true });
      const next = await h.chat("xm5-us");
      expect(next.status, `after ${scenario}`).toBe(200);
      const chunks = await readChunks(next);
      expect(ofType(chunks, "data-error")).toHaveLength(0);
      expect(terminalCount(chunks)).toBe(1);
    }
  });

  it("rejects bad requests before any stream starts", async () => {
    const h = harness();
    expect((await h.post({ messages: [], market: "US" })).status).toBe(400);
    expect((await h.post({ messages: [{ role: "user", parts: [{ type: "text", text: "x" }] }], market: "FR" })).status).toBe(400);
    const unknown = await h.chat("no-such-scenario");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ kind: "invalid_request" });
  });
});

describe("EV-006 live mode", () => {
  const liveHarness = (reply: Error) => {
    const h = harness({
      mode: "live",
      portFor: () => new ExaSdkPort({ client: fakeClient([reply, reply, reply]).client, ledger: h.store.ledger, clock: h.clock }),
    });
    return h;
  };

  it("shows no fixture data when Exa fails, and ends with the typed error", async () => {
    const h = liveHarness(new HttpError(500));
    const chunks = await readChunks(await h.chat());
    expect(ofType(chunks, "data-error")[0]!.data).toMatchObject({ kind: "upstream", partial: false });
    expect(ofType(chunks, "data-products")).toHaveLength(0);
    expect(ofType(chunks, "text-delta")).toHaveLength(0);
    expect(ofType(chunks, "source-url")).toHaveLength(0);
  });

  it("rejects fixtureScenario with invalid_request", async () => {
    const h = liveHarness(new HttpError(500));
    const res = await h.chat("xm5-us");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ kind: "invalid_request" });
  });
});

describe("EV-006 client abort", () => {
  it("aborts the in-flight Exa call, writes nothing afterwards, logs cancelled, and frees the lock", async () => {
    let searchSignal: AbortSignal | undefined;
    let searchSettled: "pending" | "rejected" | "resolved" = "pending";
    const h = harness({
      wrap: (port) => ({
        answerCandidates: (...args) => port.answerCandidates(...args),
        searchOffers: (candidate, market, budget, signal) => {
          searchSignal = signal;
          const call = port.searchOffers(candidate, market, budget, signal);
          call.then(
            () => (searchSettled = "resolved"),
            () => (searchSettled = "rejected"),
          );
          return call;
        },
      }),
    });
    const abort = new AbortController();
    const res = await h.chat("cancel-offers", { signal: abort.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!progressOf(parseSse(text)).includes("offers:running")) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream ended before the offers stage started");
      text += decoder.decode(value, { stream: true });
    }
    const before = parseSse(text).length;

    abort.abort();
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    expect(parseSse(text)).toHaveLength(before);
    expect(searchSignal?.aborted).toBe(true);
    expect(searchSettled).toBe("rejected");
    expect(h.logs.filter((l) => l.event === "cancelled")).toHaveLength(1);

    const next = await readChunks(await h.chat("xm5-us"));
    expect(ofType(next, "data-error")).toHaveLength(0);
    expect(terminalCount(next)).toBe(1);
  });
});
