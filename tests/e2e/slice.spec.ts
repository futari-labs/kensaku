import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const Q1 = "Sony WH-1000XM5 headphones: where can I buy them and are they worth it?";
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
  await page.getByTestId("inline-citation").first().hover();
  await expect(page.getByText(/^https?:\/\//).first()).toBeVisible();

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

test("a failed run shows its specific error, and a partial failure says so", async ({ page }) => {
  await page.goto("/?scenario=error-402");
  await ask(page, Q1);
  await expect(page.getByTestId("run-error")).toHaveAttribute("data-kind", "credits_exhausted");
  await expect(page.getByTestId("run-error")).toContainText("credits are exhausted");

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
