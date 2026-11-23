import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { parseConfig } from "../../src/server/config";
import { createRuntime } from "../../src/server/runtime";

const HOST = { host: "127.0.0.1:8787" };
const dirs = () => {
  const root = mkdtempSync(join(tmpdir(), "kensaku-testroutes-"));
  return { cacheDir: join(root, "cache"), commerceDir: join(root, "data") };
};

describe("the test-only routes", () => {
  it("do not exist in live mode, and the fake hosted page is not served", async () => {
    const app = createApp(createRuntime(parseConfig({}), dirs()));
    for (const path of ["/__test/commerce/reset", "/__test/commerce/expire-open-order", "/__test/commerce/checkout-configured", "/__test/checkout/cs_1/pay"]) {
      expect((await app.request(path, { method: "POST", headers: { ...HOST, "content-type": "application/json" }, body: "{}" })).status, path).toBe(404);
    }
    const page = await app.request("/__test/checkout/cs_1", { headers: HOST });
    expect(await page.text()).not.toContain("Fake Stripe Checkout");
  });

  it("answer 403 to a state-changing request from a foreign origin in fixture mode", async () => {
    const app = createApp(createRuntime(parseConfig({ NODE_ENV: "test", KENSAKU_EXA_MODE: "fixture" }), dirs()));
    const post = (origin: string) => app.request("/__test/commerce/reset", { method: "POST", headers: { ...HOST, origin } });
    expect((await post("https://evil.example")).status).toBe(403);
    expect((await post("http://127.0.0.1:8787")).status).toBe(200);
  });
});
