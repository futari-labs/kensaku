import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { Q1 } from "../fixtures/questions";

// The v1.2 vertical slice in fixture mode: research -> add -> checkout -> fake hosted page -> signed webhook -> paid.
// The fake page stands in for Stripe; the only origin the browser ever talks to is the app's own.
const ORIGIN = "http://127.0.0.1:8787";

const reset = async (request: APIRequestContext) => expect((await request.post("/__test/commerce/reset")).status()).toBe(200);
test.beforeEach(({ request }) => reset(request));
// Leaves nothing behind for the specs that run after this one.
test.afterEach(({ request }) => reset(request));

const watchOrigins = (page: Page) => {
  const origins = new Set<string>();
  page.on("request", (request) => {
    const { protocol, origin } = new URL(request.url());
    if (protocol === "http:" || protocol === "https:") origins.add(origin);
  });
  return origins;
};

async function addFirstOffer(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Question" }).fill(Q1);
  await page.getByRole("textbox", { name: "Question" }).press("Enter");
  const add = page.getByRole("button", { name: /^Add to cart: / }).first();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByTestId("cart-count")).toHaveText("1");
  await expect(page.getByTestId("cart-announcer")).toHaveText("Added to simulated cart");
}

async function checkoutFromSheet(page: Page) {
  await page.getByTestId("cart-button").click();
  const line = page.getByTestId("cart-line");
  await expect(line).toHaveCount(1);
  await expect(line.getByTestId("demo-price")).toContainText("Demo checkout price");
  await expect(line.getByTestId("observed-price")).toContainText("Last observed");
  await expect(page.getByTestId("demo-total")).toContainText("Demo total");
  await page.getByRole("button", { name: "Checkout in Stripe sandbox" }).click();
  await expect(page.getByRole("heading", { name: "Fake Stripe Checkout" })).toBeVisible();
}

test("research, add, checkout, pay on the fake page, and the verified webhook marks the order paid", async ({ page, request }) => {
  const origins = watchOrigins(page);
  await addFirstOffer(page);
  await checkoutFromSheet(page);
  await page.getByRole("button", { name: "Pay" }).click();

  await expect(page.getByTestId("checkout-return")).toHaveAttribute("data-state", "paid");
  await expect(page.getByTestId("checkout-return")).toContainText("Simulated payment received (Stripe sandbox). No order was placed with");
  await expect(page).toHaveURL(`${ORIGIN}/`);
  await expect(page.getByTestId("cart-count")).toHaveText("0");

  const orders = (await (await request.get("/api/orders")).json()) as { orders: { state: string; transitions: { to: string; eventId?: string }[] }[] };
  expect(orders.orders).toHaveLength(1);
  expect(orders.orders[0]!.state).toBe("paid");
  expect(orders.orders[0]!.transitions.filter((t) => t.to === "paid")).toHaveLength(1);
  expect([...origins]).toEqual([ORIGIN]);
});

test("Decline then Back cancels the simulated checkout and keeps the cart", async ({ page, request }) => {
  const origins = watchOrigins(page);
  await addFirstOffer(page);
  await checkoutFromSheet(page);
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("alert")).toHaveText("Your card was declined.");
  await page.getByRole("link", { name: "Back" }).click();

  await expect(page.getByTestId("checkout-return")).toContainText("Simulated checkout cancelled. Your cart is unchanged.");
  await expect(page.getByTestId("checkout-return")).toContainText("The test card was declined.");
  await expect(page.getByTestId("cart-count")).toHaveText("1");
  const orders = (await (await request.get("/api/orders")).json()) as { orders: { state: string }[] };
  expect(orders.orders.map((o) => o.state)).toEqual(["cancelled"]);
  expect([...origins]).toEqual([ORIGIN]);
});

test("the test-only routes are guarded like the rest of the API", async ({ request }) => {
  expect((await request.post("/__test/commerce/checkout-configured", { data: { value: "no" } })).status()).toBe(400);
  expect((await request.post("/__test/commerce/expire-open-order")).status()).toBe(404);
  expect((await request.post("/__test/commerce/checkout-configured", { data: { value: false } })).status()).toBe(200);
  expect(((await (await request.get("/api/cart")).json()) as { checkoutConfigured: boolean }).checkoutConfigured).toBe(false);
});
