import { expect, test } from "@playwright/test";

test("the web shell loads and the API is healthy", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kensaku" })).toBeVisible();
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect((await res.json()).ok).toBe(true);
});
