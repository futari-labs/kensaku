// EV-016 suite capture (JM-106): the live suite's own capture (`scripts/live/browser.ts`) of the /api/chat stream, driven
// through the built app in fixture mode, must equal the stream's UTF-8 bytes. Runs 1 and 2 recorded `ソニー` as `ã‚½ãƒ‹ãƒ¼`.
import { expect, test } from "@playwright/test";
import type { Market } from "../../src/core/types";
import { captureQuery } from "../../scripts/live/browser";
import { Q1 } from "../fixtures/questions";
import { ofType, parseSse } from "../server/sse";

const ORIGIN = "http://127.0.0.1:8787";

/** Scenarios whose frozen Exa responses carry non-ASCII text into the products: Japanese titles, `®`, `™`, `é`, `—`. */
const SCENARIOS: [string, Market][] = [
  ["xm5-jp", "JP"],
  ["xm5-sg-cards", "SG"],
  ["no-images", "SG"],
  ["xm5-us-cards", "US"],
];

/** The displayed data of one stream, without the per-run `retrievedAt` stamps, as UTF-8 bytes. */
function displayedBytes(stream: string): Buffer {
  const chunks = parseSse(stream);
  const displayed = { comparison: ofType(chunks, "text-delta").map((c) => c.delta), products: ofType(chunks, "data-products")[0]?.data ?? null };
  return Buffer.from(JSON.stringify(displayed, (key, value: unknown) => (key === "retrievedAt" ? undefined : value)), "utf8");
}

for (const [scenario, market] of SCENARIOS) {
  test(`the suite captures ${scenario} byte for byte as the server's UTF-8 stream`, async ({ browser }) => {
    const res = await fetch(`${ORIGIN}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: Q1 }] }], market, fixtureScenario: scenario }),
    });
    const wire = new TextDecoder("utf-8", { fatal: true }).decode(await res.arrayBuffer());
    const source = displayedBytes(wire);
    expect(source.some((b) => b >= 0x80), "the scenario must carry non-ASCII text").toBe(true);

    const capture = await captureQuery(browser, `${ORIGIN}/?scenario=${scenario}`, market, Q1);
    expect(capture.turnState).toBe("completed");
    expect(displayedBytes(capture.chatBody).equals(source), "captured products differ from the UTF-8 source").toBe(true);
  });
}
