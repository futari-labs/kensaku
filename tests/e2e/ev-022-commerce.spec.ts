// EV-022 simulated commerce UI (EVALUATION_PLAN "Commerce UI (EV-022)" checks 1-15), Chromium against `pnpm start` in fixture mode
// with the test-only hosted page. Check 14 (EV-007, EV-010, EV-015 unchanged) is the rest of the suite plus scripts/check-components.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { CART_TITLE, CHECKOUT_BUTTON_LABEL, FORBIDDEN_UI_PHRASES, ORDER_BADGE_LABELS, SIMULATION_BANNER } from "../../src/core/commerce";
import type { Order } from "../../src/core/commerce";
import type { ProductResult } from "../../src/research/events";
import { Q1 } from "../fixtures/questions";

const ORIGIN = "http://127.0.0.1:8787";
const HISTORY_KEY = "kensaku.history.v1";
const MARKET_KEY = "kensaku.market.v1";
const THEME_KEY = "kensaku.theme.v1";
const FORBIDDEN_KEY = "kensaku.test.forbidden";
const frozenHistory = JSON.parse(readFileSync(join(import.meta.dirname, "../../evals/fixtures/history/mvp-history-xm5-sg.json"), "utf8")) as { key: string; value: string };

type Theme = "dark" | "light";
type Market = "US" | "SG";

interface Watch {
  /** Every http(s) origin the page requested. */
  origins: Set<string>;
  /** Forbidden phrases the page text or an aria-label held at any moment since the document loaded. */
  forbidden: () => Promise<string[]>;
  reset: () => Promise<void>;
}

/**
 * Every test runs with two watchers (checks 11 and 13): a MutationObserver that records any forbidden phrase the moment it
 * appears, in sessionStorage so it survives the hop to the hosted page, and a log of request origins.
 */
const test = base.extend<{ watch: Watch }>({
  watch: [
    async ({ page }, use) => {
      const origins = new Set<string>();
      page.on("request", (request) => {
        const { protocol, origin } = new URL(request.url());
        if (protocol === "http:" || protocol === "https:") origins.add(origin);
      });
      await page.addInitScript(
        ([phrases, key]) => {
          const found = (): string[] => JSON.parse(sessionStorage.getItem(key!) ?? "[]");
          const scan = () => {
            const names = [...document.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label"));
            const text = [document.body?.textContent, ...names].join("\n").toLowerCase();
            const hits = (phrases as readonly string[]).filter((p) => text.includes(p.toLowerCase()));
            if (hits.some((h) => !found().includes(h))) sessionStorage.setItem(key!, JSON.stringify([...new Set([...found(), ...hits])]));
          };
          new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
          addEventListener("DOMContentLoaded", scan);
        },
        [[...FORBIDDEN_UI_PHRASES], FORBIDDEN_KEY] as const,
      );
      const watch: Watch = {
        origins,
        forbidden: () => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[], FORBIDDEN_KEY),
        reset: async () => {
          await page.evaluate((key) => sessionStorage.removeItem(key), FORBIDDEN_KEY);
        },
      };
      await use(watch);
      expect(await watch.forbidden(), "forbidden phrases seen during the test").toEqual([]);
      expect([...origins], "request origins").toEqual([ORIGIN]);
    },
    { auto: true },
  ],
});

const reset = async (request: APIRequestContext) => expect((await request.post("/__test/commerce/reset")).status()).toBe(200);
test.beforeEach(({ request }) => reset(request));
test.afterEach(({ request }) => reset(request));

const question = (page: Page) => page.getByRole("textbox", { name: "Question" });
const setStorage = (page: Page, entries: Record<string, string>) => page.evaluate((e) => Object.entries(e).forEach(([k, v]) => localStorage.setItem(k, v)), entries);
const addButtons = (scope: Page | Locator) => scope.getByRole("button", { name: /^Add to cart: / });
const lastTurn = (page: Page) => page.getByTestId("turn").last();

/** Opens a fixture scenario with the market and theme preset, asks Q1, and waits for the run to end. */
async function research(page: Page, scenario = "xm5-us", { market = "US", theme = "dark" }: { market?: Market; theme?: Theme } = {}) {
  await page.goto("/");
  await setStorage(page, { [MARKET_KEY]: market, [THEME_KEY]: theme });
  await page.goto(`/?scenario=${scenario}`);
  await expect(page.getByTestId("fixture-banner")).toBeVisible();
  await question(page).fill(Q1);
  await question(page).press("Enter");
  await expect(page.getByTestId("usage").last()).toBeVisible();
}

/** Clicks the first enabled "Add to cart" of the newest turn and waits for the header count. */
async function addNext(page: Page, count: number) {
  await addButtons(lastTurn(page)).first().click();
  await expect(page.getByTestId("cart-count")).toHaveText(String(count));
}

const offerIds = async (page: Page): Promise<string[]> => {
  const raw = (await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY))!;
  const messages = JSON.parse(raw).messages as { parts: { type: string; data?: ProductResult[] }[] }[];
  const products = messages.flatMap((m) => m.parts).find((p) => p.type === "data-products")!.data!;
  return products.flatMap((p) => p.offerGroups.flatMap((g) => g.offers.flatMap((o) => (o.id ? [o.id] : []))));
};

const sessionOf = (checkoutUrl: string) => decodeURIComponent(checkoutUrl.split("/").pop()!);

/** The cart and orders as the server holds them, for set-up that is not the thing under test. */
const server = (request: APIRequestContext) => ({
  async add(offerId: string) {
    expect((await request.post("/api/cart/items", { data: { offerId } })).status()).toBe(200);
  },
  async checkout() {
    const reply = await request.post("/api/checkout", { data: {} });
    expect(reply.status()).toBe(200);
    const { orderId, url } = (await reply.json()) as { orderId: string; url: string };
    return { orderId, sessionId: sessionOf(url), url };
  },
  /** The fake hosted page's Pay: delivers the signed completed event. The redirect is not followed. */
  async pay(sessionId: string) {
    expect((await request.post(`/__test/checkout/${encodeURIComponent(sessionId)}/pay`, { maxRedirects: 0 })).status()).toBe(303);
  },
  async orders() {
    return ((await (await request.get("/api/orders")).json()) as { orders: Order[] }).orders;
  },
  withhold: (value: boolean) => request.post("/__test/commerce/withhold-webhooks", { data: { value } }),
});

const returnUrl = (outcome: "success" | "cancelled", orderId: string, sessionId?: string) => `/?checkout=${outcome}&order=${orderId}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ""}`;
const returnPanel = (page: Page) => page.getByTestId("checkout-return");
const openSheet = async (page: Page) => {
  await page.getByTestId("cart-button").click();
  await expect(page.getByRole("dialog", { name: CART_TITLE })).toBeVisible();
};
const checkoutFromSheet = async (page: Page) => {
  await openSheet(page);
  await page.getByRole("button", { name: CHECKOUT_BUTTON_LABEL }).click();
  await expect(page.getByRole("heading", { name: "Fake Stripe Checkout" })).toBeVisible();
};

const seriousOrCritical = async (page: Page) => {
  // Settle finite animations (sheet and dialog transitions) so axe reads final colors.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} [${v.nodes.map((n) => n.target.join(" ")).join(" | ")}]`);
};

/** The visible text leads the accessible name (WCAG 2.5.3, CR-005). */
async function expectLabelInName(button: Locator) {
  const { visible, name } = await button.evaluate((el) => ({ visible: (el.textContent ?? "").trim(), name: el.getAttribute("aria-label") ?? "" }));
  expect(visible).not.toBe("");
  expect(name.startsWith(visible), `"${name}" should start with "${visible}"`).toBe(true);
}

const cents = (text: string) => Math.round(Number(/(\d[\d,]*\.\d+|\d[\d,]*)/.exec(text)![1]!.replaceAll(",", "")) * 100);

test("1. Add: every offer has Add to cart; clicking adds, shows Added, counts 1 and announces it", async ({ page }) => {
  await research(page);
  const rows = page.getByTestId("offer-row");
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);
  await expect(addButtons(page)).toHaveCount(total);
  for (const button of await addButtons(page).all()) {
    await expect(button).toBeEnabled();
    await expectLabelInName(button);
  }
  await expect(page.getByTestId("cart-count")).toHaveText("0");
  const first = addButtons(page).first();
  await first.click();
  await expect(page.getByTestId("cart-count")).toHaveText("1");
  await expect(page.getByTestId("cart-announcer")).toHaveText("Added to simulated cart");
  const added = page.getByRole("button", { name: /^Added: / }).first();
  await expect(added).toHaveText("Added");
  await expectLabelInName(added);
  await expect(page.getByRole("button", { name: "Open simulated cart, 1 items" })).toBeVisible();
});

/**
 * Rewrites the first three offers of a real run's stream so they cannot be bought: out of stock, 0.49 (below Stripe's
 * minimum) and 10.005 (not a whole number of cents). No fixture scenario has such offers, and the server is not touched.
 */
async function withUnbuyableOffers(page: Page) {
  await page.route("**/api/chat", async (route) => {
    const response = await route.fetch();
    const body = (await response.text())
      .split("\n")
      .map((line) => {
        if (!line.startsWith("data: {")) return line;
        const chunk = JSON.parse(line.slice(6)) as { type: string; data?: ProductResult[] };
        if (chunk.type !== "data-products") return line;
        const offers = chunk.data!.flatMap((p) => p.offerGroups.flatMap((g) => g.offers));
        offers[0]!.availability = "out_of_stock";
        offers[1]!.price.amount = 0.49;
        offers[2]!.price.amount = 10.005;
        return `data: ${JSON.stringify(chunk)}`;
      })
      .join("\n");
    const headers = response.headers();
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({ status: response.status(), headers, body });
  });
}

test("2. Disabled reasons: out of stock, price rules, and an offer from before v1.2 history", async ({ page }) => {
  await withUnbuyableOffers(page);
  await research(page);
  for (const label of ["Out of stock", "Below Stripe's minimum", "Price can't be charged"]) {
    const button = page.getByRole("button", { name: new RegExp(`^${label}: `) });
    await expect(button).toHaveCount(1);
    await expect(button).toBeDisabled();
    await expect(button).toHaveText(label);
    await expectLabelInName(button);
  }
  await expect(addButtons(page)).toHaveCount(0);
  await page.unroute("**/api/chat");

  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await setStorage(page, { [frozenHistory.key]: frozenHistory.value, [MARKET_KEY]: "SG" });
  await page.goto("/");
  const old = page.getByRole("button", { name: /^Ask again to buy: / });
  const rows = await page.getByTestId("offer-row").count();
  expect(rows).toBeGreaterThan(0);
  await expect(old).toHaveCount(rows);
  for (const button of await old.all()) {
    await expect(button).toBeDisabled();
    await expect(button).toHaveText("Ask again to buy");
    await expectLabelInName(button);
  }
  // The tooltip explains the reason to a pointer user (the disabled button itself cannot take focus).
  await old.first().locator("xpath=..").hover();
  await expect(page.getByRole("tooltip").first()).toContainText("Ask the question again");
});

test("3. Currency replace: Keep cart leaves the USD line, Replace leaves only the SGD line", async ({ page }) => {
  await research(page);
  await addNext(page, 1);
  await page.goto("/?scenario=xm5-sg");
  await setStorage(page, { [MARKET_KEY]: "SG" });
  await page.goto("/?scenario=xm5-sg");
  await question(page).fill(Q1);
  await question(page).press("Enter");
  await expect(page.getByTestId("usage").last()).toBeVisible();
  const add = addButtons(lastTurn(page)).first();

  await add.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Your simulated cart has USD items. Replace them with this SGD item?");
  await dialog.getByRole("button", { name: "Keep cart" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(page.getByTestId("cart-count")).toHaveText("1");
  await openSheet(page);
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("demo-price")).toContainText("USD");
  await page.keyboard.press("Escape");

  await add.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Replace" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("cart-count")).toHaveText("1");
  await openSheet(page);
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("demo-price")).toContainText("SGD");
  await expect(page.getByTestId("demo-price")).not.toContainText("USD");
});

test("4. Prices distinct: demo price and last observed price are separate elements, and the demo total is the sum of the lines", async ({ page }) => {
  await research(page);
  await addNext(page, 1);
  await addNext(page, 2);
  await openSheet(page);
  await page.getByRole("button", { name: /^Increase quantity of / }).first().click();
  await expect(page.getByTestId("line-quantity").first()).toContainText("2");
  const lines = page.getByTestId("cart-line");
  await expect(lines).toHaveCount(2);
  let sum = 0;
  for (const line of await lines.all()) {
    const demo = line.getByTestId("demo-price");
    const observed = line.getByTestId("observed-price");
    await expect(demo).toContainText(/^Demo checkout price \d/);
    await expect(observed).toContainText(/^Last observed \d[\d,.]* [A-Z]{3} on [a-z0-9.-]+, /);
    expect(await demo.textContent()).not.toContain("Last observed");
    expect(await observed.textContent()).not.toContain("Demo checkout price");
    const quantity = Number((await line.getByTestId("line-quantity").textContent())!.match(/\d+/)![0]);
    sum += cents((await demo.textContent())!) * quantity;
  }
  expect(cents((await page.getByTestId("demo-total").textContent())!)).toBe(sum);
  await expect(page.getByTestId("demo-total")).toContainText(/^Demo total /);
});

test("5. Success: Pay returns to Confirming, then the verified webhook makes it Paid, empties the cart and lists a Paid order", async ({ page, request, watch }) => {
  const api = server(request);
  await research(page);
  await addNext(page, 1);
  await api.withhold(true);
  await checkoutFromSheet(page);
  await page.getByRole("button", { name: "Pay" }).click();

  await expect(returnPanel(page)).toHaveAttribute("data-state", "confirming");
  await expect(returnPanel(page)).toContainText("Confirming simulated payment…");
  await expect(page).toHaveURL(`${ORIGIN}/`);
  const [order] = await api.orders();
  expect(order!.state).toBe("open");
  await api.withhold(false);
  await api.pay(order!.stripeSessionId!);

  await expect(returnPanel(page)).toHaveAttribute("data-state", "paid");
  const host = order!.lines[0]!.merchantHost;
  await expect(returnPanel(page)).toContainText(`Simulated payment received (Stripe sandbox). No order was placed with ${host}.`);
  await expect(page.getByTestId("cart-count")).toHaveText("0");
  await openSheet(page);
  await expect(page.getByTestId("order-row")).toHaveCount(1);
  await expect(page.getByTestId("order-row").first()).toContainText(ORDER_BADGE_LABELS.paid);
  expect([...watch.origins]).toEqual([ORIGIN]);
});

test("6. Decline then Back: cancelled with the best-effort decline note, the cart keeps its lines, the order is Cancelled", async ({ page }) => {
  await research(page);
  await addNext(page, 1);
  await checkoutFromSheet(page);
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("alert")).toHaveText("Your card was declined.");
  await page.getByRole("link", { name: "Back" }).click();

  await expect(returnPanel(page)).toHaveAttribute("data-state", "cancelled");
  await expect(returnPanel(page)).toContainText("Simulated checkout cancelled. Your cart is unchanged.");
  await expect(returnPanel(page)).toContainText("The test card was declined.");
  await expect(page.getByTestId("cart-count")).toHaveText("1");
  await openSheet(page);
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("order-row").first()).toContainText(ORDER_BADGE_LABELS.cancelled);
});

test("7. Cancel: Back without declining gives the cancelled message without the decline note", async ({ page }) => {
  await research(page);
  await addNext(page, 1);
  await checkoutFromSheet(page);
  await page.getByRole("link", { name: "Back" }).click();
  await expect(returnPanel(page)).toContainText("Simulated checkout cancelled. Your cart is unchanged.");
  await expect(returnPanel(page)).not.toContainText("The test card was declined.");
  await expect(page.getByTestId("cart-count")).toHaveText("1");
});

test("8. Duplicate: re-posting the same signed completed event leaves one Paid order and no second confirmation", async ({ page, request }) => {
  const api = server(request);
  await research(page);
  await addNext(page, 1);
  await checkoutFromSheet(page);
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(returnPanel(page)).toHaveAttribute("data-state", "paid");
  const [paid] = await api.orders();
  await api.pay(paid!.stripeSessionId!);
  await api.pay(paid!.stripeSessionId!);

  await page.waitForTimeout(1_500);
  const orders = await api.orders();
  expect(orders).toHaveLength(1);
  expect(orders[0]!.state).toBe("paid");
  expect(orders[0]!.transitions.filter((t) => t.to === "paid")).toHaveLength(1);
  await expect(returnPanel(page)).toHaveCount(1);
  await expect(page.getByTestId("cart-count")).toHaveText("0");
});

test("9. Not configured: the cart works, checkout is disabled with the README hint", async ({ page, request }) => {
  expect((await request.post("/__test/commerce/checkout-configured", { data: { value: false } })).status()).toBe(200);
  await research(page);
  await addNext(page, 1);
  await openSheet(page);
  await expect(page.getByRole("button", { name: CHECKOUT_BUTTON_LABEL })).toBeDisabled();
  await expect(page.getByRole("dialog", { name: CART_TITLE })).toContainText("Stripe sandbox is not configured. See README.");
});

test("10. Waiting hint: the stripe listen hint appears 20 s after Confirming, and polling carries on to Paid", async ({ page, request }) => {
  const api = server(request);
  // The page clock runs at real speed until it is moved, so the 20 s are skipped, not waited.
  await page.clock.install();
  await research(page);
  await addNext(page, 1);
  await api.withhold(true);
  await checkoutFromSheet(page);
  await page.getByRole("button", { name: "Pay" }).click();

  await expect(returnPanel(page)).toHaveAttribute("data-state", "confirming");
  await expect(returnPanel(page)).not.toContainText("stripe listen");
  await page.clock.fastForward(19_000);
  await expect(returnPanel(page)).not.toContainText("stripe listen");
  await page.clock.fastForward(2_000);
  await expect(returnPanel(page)).toContainText("Still waiting for Stripe's confirmation. Is `stripe listen` running?");
  await expect(returnPanel(page)).toHaveAttribute("data-state", "confirming");

  const [order] = await api.orders();
  await api.withhold(false);
  await api.pay(order!.stripeSessionId!);
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(5_000);
        return returnPanel(page).getAttribute("data-state");
      },
      { timeout: 15_000 },
    )
    .toBe("paid");
});

test("11. Labels: the Simulated cart, its banner and Simulated badges show; no forbidden phrase appears during the whole journey", async ({ page, request, watch }) => {
  const api = server(request);
  await research(page);
  await addNext(page, 1);
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: CART_TITLE });
  await expect(sheet.getByRole("heading", { name: CART_TITLE })).toBeVisible();
  await expect(sheet).toContainText(SIMULATION_BANNER);
  await page.keyboard.press("Escape");
  await page.getByTestId("cart-button").click();
  await sheet.getByRole("button", { name: CHECKOUT_BUTTON_LABEL }).click();
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(returnPanel(page)).toContainText("Simulated payment received");
  await openSheet(page);
  await expect(page.getByTestId("order-row").first().getByText(/^Simulated · /)).toBeVisible();
  expect((await api.orders())[0]!.state).toBe("paid");

  // The watcher is live: a forbidden phrase in the page text, in any case, is recorded.
  expect(await watch.forbidden()).toEqual([]);
  await page.evaluate(() => document.body.append(Object.assign(document.createElement("p"), { id: "probe", textContent: "ORDER Placed" })));
  await expect.poll(() => watch.forbidden()).toEqual(["Order placed"]);
  await page.evaluate(() => document.getElementById("probe")?.remove());
  await watch.reset();
});

test.describe("12. Accessibility", () => {
  const tabTo = async (page: Page, target: Locator, key = "Tab") => {
    for (let i = 0; i < 40; i++) {
      if (await target.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press(key);
    }
    throw new Error(`Focus never reached ${target}`);
  };

  test("keyboard only: open the sheet, change quantity, remove, close with focus back on the trigger, check out", async ({ page }) => {
    await research(page);
    await addNext(page, 1);
    await addNext(page, 2);
    await page.goto("/");
    const trigger = page.getByTestId("cart-button");
    await expect(trigger).toBeEnabled();

    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: CART_TITLE });
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("cart-line")).toHaveCount(2);

    await tabTo(page, page.getByRole("button", { name: /^Increase quantity of / }).first());
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("line-quantity").first()).toContainText("2");
    await tabTo(page, page.getByRole("button", { name: /^Remove .* from simulated cart$/ }).last());
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(sheet).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: CHECKOUT_BUTTON_LABEL }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Fake Stripe Checkout" })).toBeVisible();
  });

  test("keyboard only: the currency dialog holds focus and Escape returns it to Add to cart", async ({ page }) => {
    await research(page);
    await addNext(page, 1);
    await setStorage(page, { [MARKET_KEY]: "SG" });
    await page.goto("/?scenario=xm5-sg");
    await question(page).fill(Q1);
    await question(page).press("Enter");
    await expect(page.getByTestId("usage").last()).toBeVisible();
    const add = addButtons(lastTurn(page)).first();
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  for (const theme of ["dark", "light"] as const) {
    test(`axe: no serious or critical violations in the ${theme} theme with the sheet open and on each return panel`, async ({ page, request, watch }) => {
      const api = server(request);
      await research(page, "xm5-us", { theme });
      await addNext(page, 1);
      const [offerId] = await offerIds(page);

      await openSheet(page);
      expect(await seriousOrCritical(page), "sheet with a line").toEqual([]);
      await page.keyboard.press("Escape");

      const panels: [string, string][] = [];
      const check = async (state: string, url: string) => {
        await page.goto(url);
        await expect(returnPanel(page)).toHaveAttribute("data-state", state);
        panels.push([state, url]);
        expect(await seriousOrCritical(page), `${state} panel`).toEqual([]);
      };

      const a = await api.checkout();
      await check("cancelled", returnUrl("cancelled", a.orderId));

      await api.withhold(true);
      const b = await api.checkout();
      await check("confirming", returnUrl("success", b.orderId, b.sessionId));
      await check("unknown", returnUrl("success", b.orderId, "cs_wrong"));
      await api.withhold(false);
      await api.pay(b.sessionId);
      await check("paid", returnUrl("success", b.orderId, b.sessionId));

      await api.add(offerId!);
      const c = await api.checkout();
      await api.checkout();
      await check("expired", returnUrl("success", c.orderId, c.sessionId));

      await page.route("**/api/orders/*/cancel", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ code: "stripe-error" }) }));
      await check("cancel-failed", returnUrl("cancelled", (await api.orders())[0]!.orderId));
      await page.unroute("**/api/orders/*/cancel");
      await page.route("**/api/orders/**", (route) => route.abort());
      await check("unreachable", returnUrl("cancelled", (await api.orders())[0]!.orderId));
      await page.unroute("**/api/orders/**");

      expect(panels.map(([state]) => state)).toEqual(["cancelled", "confirming", "unknown", "paid", "expired", "cancel-failed", "unreachable"]);
      expect((await request.post("/__test/commerce/expire-open-order")).status()).toBe(200);
      await page.goto("/");
      await openSheet(page);
      await expect(page.getByTestId("order-row").first()).toContainText("Checkout link expired");
      expect(await seriousOrCritical(page), "sheet with the order list").toEqual([]);
      expect(await watch.forbidden()).toEqual([]);
    });
  }
});

test("13. No third-party requests: the whole journey touches only the local origin", async ({ page, watch }) => {
  await research(page);
  await addNext(page, 1);
  await checkoutFromSheet(page);
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(returnPanel(page)).toHaveAttribute("data-state", "paid");
  expect([...watch.origins]).toEqual([ORIGIN]);
});

test("15. Expired link: an open order past its expiry says so, and the next checkout supersedes it", async ({ page, request }) => {
  const api = server(request);
  await research(page);
  await addNext(page, 1);
  const first = await api.checkout();
  expect((await request.post("/__test/commerce/expire-open-order")).status()).toBe(200);

  await page.goto("/");
  await openSheet(page);
  const rows = page.getByTestId("order-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Checkout link expired");
  await expect(rows.first()).toContainText(ORDER_BADGE_LABELS.open);

  await page.getByRole("button", { name: CHECKOUT_BUTTON_LABEL }).click();
  await expect(page.getByRole("heading", { name: "Fake Stripe Checkout" })).toBeVisible();
  const orders = await api.orders();
  expect(orders.map((o) => o.state)).toEqual(["open", "expired"]);
  expect(orders[1]!.orderId).toBe(first.orderId);
  expect(orders[1]!.reason).toBe("superseded");

  await page.goto("/");
  await openSheet(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(ORDER_BADGE_LABELS.expired);
  await expect(rows.nth(1)).not.toContainText("Checkout link expired");
});
