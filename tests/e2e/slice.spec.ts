import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Q1 } from "../fixtures/questions";

const a1 = JSON.parse(readFileSync(join(import.meta.dirname, "../../evals/fixtures/exa-live/A1-answer.json"), "utf8")) as {
  response: { citations: { url: string }[] };
};
const citationUrls = a1.response.citations.map((c) => c.url);

const ask = async (page: Page, text: string) => {
  await page.getByRole("textbox", { name: "Question" }).fill(text);
  await page.getByRole("textbox", { name: "Question" }).press("Enter");
};

test("fixture run: progress, cited comparison, offer table, and separate evidence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("fixture-banner")).toContainText("Fixture data");
  await expect(page.getByRole("heading", { name: "Ask a shopping question" })).toBeVisible();

  await ask(page, Q1);

  const stages = page.getByTestId("progress").locator("li");
  await expect(stages).toHaveText([/Finding candidates/, /Gathering offers/, /Validating offers/, /Writing the comparison/]);
  for (const stage of ["candidates", "offers", "validate", "compare"]) {
    await expect(page.locator(`[data-stage="${stage}"]`)).toHaveAttribute("data-status", "done");
  }

  // Comparison: inline citations, and source links that are exactly citations of this run.
  const paragraphs = page.getByTestId("comparison-paragraph");
  await expect(paragraphs.first()).toBeVisible();
  expect(await page.getByTestId("inline-citation").count()).toBeGreaterThan(0);
  const uncited = await page.locator('[data-testid="comparison-paragraph"][data-cited="false"]').count();
  await expect(page.getByTestId("uncited-flag")).toHaveCount(uncited);
  await page.getByRole("button", { name: /Used \d+ sources/ }).click();
  const hrefs = await page.getByTestId("source-link").evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(citationUrls).toContain(href);
  await page.getByTestId("inline-citation").first().click();
  await expect(page.getByTestId("citation-link").first()).toBeVisible();

  // Offers: merchant host, price with currency code, availability, retrieved time, link.
  await expect(page.getByTestId("last-observed-notice")).toContainText("last observed");
  const row = page.getByTestId("offer-row").first();
  await expect(row).toBeVisible();
  await expect(row.locator("td").nth(0)).not.toBeEmpty();
  await expect(row.locator("td").nth(1)).toHaveText(/\d[\d,]*(\.\d\d)? USD/);
  await expect(row.locator("td").nth(2)).toHaveText(/In stock|Out of stock|Preorder|Availability unknown/);
  await expect(row.locator("td").nth(3).locator("time")).toHaveAttribute("datetime", /^\d{4}-\d\d-\d\dT/);
  await expect(row.getByRole("link", { name: /View .* at / })).toHaveAttribute("href", /^https:\/\//);

  // Evidence is its own labeled section, outside every offer table.
  const evidence = page.getByTestId("evidence").first();
  await expect(evidence).toContainText("Research evidence (not merchant offers)");
  await expect(evidence.getByTestId("evidence-item").first()).toContainText("not a merchant offer");
  expect(await page.getByTestId("offer-table").getByTestId("evidence").count()).toBe(0);
  await expect(page.getByTestId("usage")).toContainText("Exa requests: 2");
});

test("an image loads through the proxy, with its key specs and reason, and the page makes no request to a non-local origin", async ({ page }) => {
  const origins = new Set<string>();
  const imageReplies: { status: number; type: string | undefined }[] = [];
  page.on("request", (request) => {
    const { protocol, origin } = new URL(request.url());
    if (protocol === "http:" || protocol === "https:") origins.add(origin);
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/image/")) imageReplies.push({ status: response.status(), type: response.headers()["content-type"] });
  });
  await page.addInitScript(() => localStorage.setItem("kensaku.market.v1", "SG"));
  await page.goto("/?scenario=xm5-sg-cards");
  await ask(page, Q1);

  const first = page.getByTestId("product").first();
  const figure = first.getByTestId("product-image");
  await expect(figure).toHaveAttribute("data-loaded", "true");
  // The first candidate fails rule I3 (422), so the caption names the second one, which loaded.
  await expect(first.getByTestId("image-caption")).toContainText("stereo.com.sg");
  const img = figure.locator("img");
  await expect(img).toHaveAttribute("src", /^\/api\/image\/[0-9a-f]{64}$/);
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(imageReplies.some((r) => r.status === 422)).toBe(true);
  expect(imageReplies.some((r) => r.status === 200 && r.type === "image/jpeg")).toBe(true);

  await expect(first.getByTestId("key-specs").locator("li")).toHaveCount(4);
  await expect(first.getByTestId("reason")).toContainText("frequent travel");
  await expect(first.getByTestId("reason").getByRole("link").first()).toHaveAttribute("href", /^https:\/\//);

  expect([...origins]).toEqual(["http://127.0.0.1:8787"]);
});

test("a product whose every image candidate fails shows the no-image panel", async ({ page }) => {
  await page.route("**/api/image/*", (route) => route.fulfill({ status: 502, contentType: "application/json", body: "{}" }));
  await page.addInitScript(() => localStorage.setItem("kensaku.market.v1", "SG"));
  await page.goto("/?scenario=xm5-sg-cards");
  await ask(page, Q1);
  await expect(page.getByTestId("no-image")).toHaveCount(2);
  await expect(page.getByTestId("no-image").first()).toHaveText("No verified product image");
});

test("running state: input disabled, Cancel works, and the server is free for the next run", async ({ page, request }) => {
  await page.goto("/?scenario=cancel-offers");
  await ask(page, Q1);
  await expect(page.locator('[data-stage="offers"]')).toHaveAttribute("data-status", "running");
  await expect(page.getByRole("textbox", { name: "Question" })).toBeDisabled();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("run-cancelled")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Question" })).toBeEnabled();

  // The aborted run must have released the server's run lock: a new run is accepted, not refused with 409.
  await expect(async () => {
    const res = await request.post("/api/chat", {
      data: { messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: Q1 }] }], market: "US", fixtureScenario: "xm5-us" },
    });
    expect(res.status()).toBe(200);
  }).toPass({ timeout: 10_000 });
});

test("cancelling before the reply starts (no assistant message yet) still ends cancelled", async ({ page }) => {
  // The request never answers, so useChat stays in `submitted`.
  await page.route("**/api/chat", () => new Promise(() => {}));
  await page.goto("/");
  await ask(page, Q1);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("run-cancelled")).toContainText("No results were received");
  await expect(page.getByRole("textbox", { name: "Question" })).toBeEnabled();
});

test("a failed run shows its specific error, and a partial failure says so", async ({ page }) => {
  await page.goto("/?scenario=error-402");
  await ask(page, Q1);
  await expect(page.getByTestId("run-error")).toHaveAttribute("data-kind", "credits_exhausted");
  await expect(page.getByTestId("run-error")).toContainText("credits are exhausted");

  await page.evaluate(() => localStorage.clear());
  await page.goto("/?scenario=error-offers");
  await ask(page, Q1);
  await expect(page.getByTestId("run-error")).toContainText("results below are partial");
  await expect(page.getByTestId("product")).toBeVisible();
});

test("the web shell loads and the API is healthy", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kensaku", level: 1 })).toBeVisible();
  const res = await request.get("/api/health");
  expect(await res.json()).toEqual({ ok: true, exaConfigured: false, mode: "fixture" });
});
