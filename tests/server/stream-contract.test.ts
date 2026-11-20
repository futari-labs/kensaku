// The stream contract end to end: the chunks `toChunks` writes, read back the way the web app reads them.
import { readUIMessageStream } from "ai";
import { describe, expect, it } from "vitest";
import type { KensakuMessage } from "../../src/research/events";
import { emptyView, runStateOf, viewOf } from "../../src/web/app/messages";
import { harness } from "./helpers";
import { readChunks } from "./sse";

async function messageOf(scenario: string): Promise<KensakuMessage> {
  const chunks = await readChunks(await harness().chat(scenario));
  let message: KensakuMessage | undefined;
  for await (const m of readUIMessageStream<KensakuMessage>({ stream: new ReadableStream({ start: (c) => (chunks.forEach((x) => c.enqueue(x)), c.close()) }) })) message = m;
  return message!;
}

describe("stream contract: toChunks to viewOf", () => {
  it("a completed run reads back as progress, comparison, sources, products, and usage", async () => {
    const view = viewOf(await messageOf("xm5-us"));
    expect(view.progress.map((p) => p.stage)).toContain("compare");
    expect(view.text).toBeTruthy();
    expect(view.sources.length).toBeGreaterThan(0);
    expect(view.sources.every((s) => /^\d+(,\d+)*$/.test(s.sourceId))).toBe(true);
    expect(view.products?.[0]?.offerGroups.length).toBeGreaterThan(0);
    expect(view.usage).toMatchObject({ exaRequests: 2, monthLimit: 400 });
    expect(view.error).toBeUndefined();
    expect(runStateOf(view, { streaming: false, cancelled: false })).toBe("completed");
  });

  it("a failed run reads back as failed", async () => {
    const view = viewOf(await messageOf("error-401"));
    expect(view.error).toMatchObject({ kind: "auth", partial: false });
    expect(runStateOf(view, { streaming: false, cancelled: false })).toBe("failed");
  });
});

describe("runStateOf", () => {
  const view = emptyView();
  it("is running while streaming, and cancelled wins over the stream", () => {
    expect(runStateOf(view, { streaming: true, cancelled: false })).toBe("running");
    expect(runStateOf(view, { streaming: true, cancelled: true })).toBe("cancelled");
  });

  it("is cancelled for a run that never got an assistant message", () => {
    expect(runStateOf(emptyView(), { streaming: false, cancelled: true })).toBe("cancelled");
  });
});
