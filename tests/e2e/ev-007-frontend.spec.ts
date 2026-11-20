// EV-007 frontend quality (EVALUATION_PLAN "Frontend quality" items 1-8), Chromium against `pnpm start` in fixture mode.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Q1 } from "../fixtures/questions";
import { TEST_EXA_KEY } from "../fixtures/test-key";

const root = join(import.meta.dirname, "../..");
const a1 = JSON.parse(readFileSync(join(root, "evals/fixtures/exa-live/A1-answer.json"), "utf8")) as { response: { citations: { url: string }[] } };
const citationUrls = a1.response.citations.map((c) => c.url);

const HISTORY_KEY = "kensaku.history.v1";
const MARKET_KEY = "kensaku.market.v1";

const question = (page: Page) => page.getByRole("textbox", { name: "Question" });
const ask = async (page: Page, text = Q1) => {
  await question(page).fill(text);
  await question(page).press("Enter");
};
const finished = (page: Page) => expect(page.getByTestId("usage").last()).toBeVisible();
const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const chooseMarket = async (page: Page, name: RegExp) => {
  await page.getByTestId("market-select").click();
  await page.getByRole("option", { name }).click();
};

const uiStream = (chunks: object[]) => ({
  status: 200,
  headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
  body: [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join(""),
});

// Item 1: primary journey.
test("1. primary journey: stages in order, cited comparison, offer table fields, separate evidence, last-observed notice", async ({ page }) => {
  await page.goto("/");
  await ask(page);

  await expect(page.getByTestId("progress").locator("li")).toHaveText([/Finding candidates/, /Gathering offers/, /Validating offers/, /Writing the comparison/]);
  for (const stage of ["candidates", "offers", "validate", "compare"]) {
    await expect(page.locator(`[data-stage="${stage}"]`)).toHaveAttribute("data-status", "done");
  }
  await finished(page);

  expect(await page.getByTestId("inline-citation").count()).toBeGreaterThan(0);
  await page.getByRole("button", { name: /Used \d+ sources/ }).click();
  const hrefs = await page.getByTestId("source-link").evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(citationUrls).toContain(href);

  await expect(page.getByTestId("last-observed-notice")).toContainText("last observed");
  const row = page.getByTestId("offer-row").first();
  await expect(row.locator("td").nth(0)).not.toBeEmpty();
  await expect(row.locator("td").nth(1)).toHaveText(/\d[\d,]*(\.\d\d)? USD/);
  await expect(row.locator("td").nth(2).locator('[data-slot="badge"]')).toHaveText(/In stock|Out of stock|Preorder|Availability unknown/);
  await expect(row.locator("td").nth(3).locator("time")).toHaveAttribute("datetime", /^\d{4}-\d\d-\d\dT/);
  await expect(row.getByRole("link", { name: /View .* at / })).toHaveAttribute("href", /^https:\/\//);
  await expect(page.getByRole("columnheader")).toHaveText(["Merchant", "Price", "Availability", "Retrieved", "Link"]);

  const evidence = page.getByTestId("evidence").first();
  await expect(evidence).toContainText("Research evidence (not merchant offers)");
  expect(await page.getByTestId("offer-table").getByTestId("evidence").count()).toBe(0);
});

// Item 2: states.
test.describe("2. states", () => {
  test("empty state offers suggestions and a market selector; a suggestion starts a run", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ask a shopping question" })).toBeVisible();
    await expect(page.getByTestId("market-select")).toContainText("United States");
    const suggestions = page.getByRole("button", { name: /Sony WH-1000XM5|ergonomic wireless mouse/ });
    await expect(suggestions).toHaveCount(2);
    await suggestions.first().click();
    await expect(page.locator('[data-stage="candidates"]')).toBeVisible();
    await finished(page);
  });

  test("running state: input and market disabled, a stage running, Cancel works", async ({ page }) => {
    await page.goto("/?scenario=cancel-offers");
    await ask(page);
    await expect(page.locator('[data-stage="offers"]')).toHaveAttribute("data-status", "running");
    await expect(question(page)).toBeDisabled();
    await expect(page.getByTestId("market-select")).toBeDisabled();
    await expect(page.getByTestId("announcer")).toHaveText("Gathering offers.");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("run-cancelled")).toContainText("Run cancelled");
    await expect(question(page)).toBeEnabled();
  });

  test("a cancelled run keeps its notice after the next question is sent, and after a reload", async ({ page }) => {
    await page.goto("/?scenario=cancel-offers");
    await ask(page);
    await expect(page.locator('[data-stage="offers"]')).toHaveAttribute("data-status", "running");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("run-cancelled")).toHaveCount(1);
    await ask(page, "Best ergonomic wireless mouse for programming under $120");
    await expect(page.getByTestId("turn")).toHaveCount(2);
    await expect(page.getByTestId("turn").first()).toHaveAttribute("data-state", "cancelled");
    await expect(page.locator('[data-stage="offers"]').last()).toHaveAttribute("data-status", "running");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("run-cancelled")).toHaveCount(2);
    await page.reload();
    await expect(page.getByTestId("run-cancelled")).toHaveCount(2);
  });

  test("a question cancelled before any reply is cancelled, and stays so after the next question", async ({ page }) => {
    let hold = true;
    await page.route("**/api/chat", (route) => (hold ? new Promise(() => {}) : route.continue()));
    await page.goto("/");
    await ask(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("run-cancelled")).toContainText("No results were received");
    hold = false;
    await ask(page, "Best ergonomic wireless mouse for programming under $120");
    await expect(page.getByTestId("turn")).toHaveCount(2);
    await expect(page.getByTestId("turn").first()).toHaveAttribute("data-state", "cancelled");
    await expect(page.getByTestId("run-cancelled")).toHaveCount(1);
  });

  test("no offers: explicit text per product, no placeholder price, evidence still shown", async ({ page }) => {
    await page.goto("/?scenario=no-offers");
    await ask(page);
    await finished(page);
    await expect(page.getByTestId("no-offers")).toHaveText("No direct merchant offers with a listed price were found.");
    await expect(page.getByTestId("offer-row")).toHaveCount(0);
    await expect(page.getByTestId("product")).not.toContainText(/\d+(\.\d\d)? (USD|SGD|JPY)(?! reported)/);
  });

  const runErrors: [string, string, RegExp][] = [
    ["error-401", "auth", /rejected the API key/],
    ["error-402", "credits_exhausted", /credits are exhausted/],
    ["error-429", "rate_limited", /rate limiting/],
    ["error-500", "upstream", /Exa is unavailable/],
    ["error-timeout", "timeout", /timed out/],
  ];
  for (const [scenario, kind, text] of runErrors) {
    test(`error kind ${kind} (${scenario}) shows its specific message`, async ({ page }) => {
      await page.goto(`/?scenario=${scenario}`);
      await ask(page);
      await expect(page.getByTestId("run-error")).toHaveAttribute("data-kind", kind);
      await expect(page.getByTestId("run-error")).toContainText(text);
      await expect(question(page)).toBeEnabled();
    });
  }

  test("error kind monthly_limit shows its specific message", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      route.fulfill(
        uiStream([
          { type: "start", messageId: "run-1" },
          { type: "data-error", id: "error", data: { kind: "monthly_limit", message: "limit", partial: false } },
          { type: "finish" },
        ]),
      ),
    );
    await page.goto("/");
    await ask(page);
    await expect(page.getByTestId("run-error")).toHaveAttribute("data-kind", "monthly_limit");
    await expect(page.getByTestId("run-error")).toContainText(/monthly Exa request or cost limit/);
  });

  for (const [status, kind, text] of [
    [400, "invalid_request", /request was not valid/],
    [409, "run_in_progress", /already in progress/],
  ] as const) {
    test(`HTTP ${status} shows ${kind}, keeps it in the conversation, and the next question works`, async ({ page }) => {
      let reject = true;
      await page.route("**/api/chat", (route) =>
        reject ? route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ kind, message: "x" }) }) : route.continue(),
      );
      await page.goto("/");
      await ask(page);
      await expect(page.getByTestId("run-error")).toHaveAttribute("data-kind", kind);
      await expect(page.getByTestId("run-error")).toContainText(text);
      reject = false;
      await ask(page);
      await finished(page);
      await expect(page.getByTestId("run-error")).toHaveCount(1);
      await expect(page.getByTestId("turn")).toHaveCount(2);
    });
  }

  test("a broken connection is shown as a failed run", async ({ page }) => {
    await page.route("**/api/chat", (route) => route.abort("connectionrefused"));
    await page.goto("/");
    await ask(page);
    await expect(page.getByTestId("run-error")).toHaveAttribute("data-kind", "upstream");
  });

  test("partial results are labeled partial and stay visible", async ({ page }) => {
    await page.goto("/?scenario=error-offers");
    await ask(page);
    await expect(page.getByTestId("run-error")).toContainText("results below are partial");
    await expect(page.getByTestId("product")).toBeVisible();
  });
});

// Item 3: history.
test.describe("3. history", () => {
  test("the conversation, results included, is restored after a reload", async ({ page }) => {
    await page.goto("/");
    await ask(page);
    await finished(page);
    const before = await page.getByTestId("offer-row").count();
    expect(JSON.parse((await stored(page, HISTORY_KEY)) ?? "null")).toMatchObject({ version: 1, savedAt: expect.any(String) });

    await page.reload();
    await expect(page.getByTestId("history-notice")).toHaveCount(0);
    await expect(page.getByTestId("turn")).toHaveCount(1);
    await expect(page.getByTestId("turn")).toContainText(Q1);
    await expect(page.getByTestId("offer-row")).toHaveCount(before);
    await expect(page.getByTestId("inline-citation").first()).toBeVisible();
    await expect(page.getByTestId("usage")).toBeVisible();
    await expect(page.getByTestId("turn")).toHaveAttribute("data-state", "completed");
  });

  test("a failed run is saved and restored", async ({ page }) => {
    await page.goto("/?scenario=error-402");
    await ask(page);
    await expect(page.getByTestId("run-error")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("run-error")).toHaveAttribute("data-kind", "credits_exhausted");
  });

  test("Clear history asks first; keeping leaves it, confirming empties the thread and removes the key", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Clear history" })).toBeDisabled();
    await ask(page);
    await finished(page);

    await page.getByRole("button", { name: "Clear history" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Clear history?");
    await dialog.getByRole("button", { name: "Keep history" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByTestId("turn")).toHaveCount(1);
    expect(await stored(page, HISTORY_KEY)).not.toBeNull();

    await page.getByRole("button", { name: "Clear history" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Clear history" }).click();
    await expect(page.getByTestId("turn")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Ask a shopping question" })).toBeVisible();
    expect(await stored(page, HISTORY_KEY)).toBeNull();
    await page.reload();
    await expect(page.getByTestId("turn")).toHaveCount(0);
  });

  const corrupt: [string, string, RegExp][] = [
    ["not JSON", "{not json", /could not be read/],
    ["wrong shape", JSON.stringify({ version: 1, messages: [{ id: 1 }], savedAt: "x" }), /could not be read/],
    ["a newer version", JSON.stringify({ version: 2, messages: [], savedAt: "x" }), /newer version/],
  ];
  for (const [name, value, text] of corrupt) {
    test(`stored data that is ${name} is discarded with a notice`, async ({ page }) => {
      await page.goto("/");
      await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [HISTORY_KEY, value]);
      await page.reload();
      await expect(page.getByTestId("history-notice")).toContainText(text);
      await expect(page.getByTestId("turn")).toHaveCount(0);
      expect(await stored(page, HISTORY_KEY)).toBeNull();
      await ask(page);
      await finished(page);
      await page.getByRole("button", { name: "Dismiss" }).click();
      await expect(page.getByTestId("history-notice")).toHaveCount(0);
    });
  }

  test("blocked storage does not break the app", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get: () => { throw new Error("blocked"); } });
    });
    await page.goto("/");
    await ask(page);
    await finished(page);
    await expect(page.getByTestId("market-select")).toContainText("United States");
  });
});

// Item 4: market.
test.describe("4. market", () => {
  for (const [market, scenario, label, currency] of [
    ["SG", "xm5-sg", /Singapore/, "SGD"],
    ["JP", "xm5-jp", /Japan/, "JPY"],
  ] as const) {
    test(`${market}: sent in the request, its currency group first, and the choice survives a reload`, async ({ page }) => {
      await page.goto(`/?scenario=${scenario}`);
      await chooseMarket(page, label);
      expect(await stored(page, MARKET_KEY)).toBe(market);

      const request = page.waitForRequest((r) => r.url().endsWith("/api/chat"));
      await ask(page);
      expect((await request).postDataJSON()).toMatchObject({ market });
      await finished(page);
      const captions = await page.getByTestId("offer-table").locator("caption").allTextContents();
      expect(captions[0]).toBe(`Prices in ${currency}`);

      await page.reload();
      await expect(page.getByTestId("market-select")).toContainText(label);
    });
  }

  test("the page shows the server's group order: the market's currency first, whichever market is chosen", async ({ page }) => {
    // The server's own ordering is EV-003; this stands in for it to show the page keeps the order it receives and sends the market.
    const order = { US: ["USD", "SGD"], SG: ["SGD", "USD"], JP: ["JPY", "USD"] } as const;
    const offer = (currency: string, amount: number) => ({
      kind: "merchant-offer", merchantHost: "shop.example", merchantName: "Example Shop", canonicalUrl: `https://shop.example/${currency}`,
      price: { amount, currency }, availability: "in_stock", source: "exa", retrievedAt: "2026-11-21T00:00:00.000Z", exaRequestId: "r", productName: "Widget",
    });
    await page.route("**/api/chat", (route) => {
      const { market } = route.request().postDataJSON() as { market: keyof typeof order };
      const products = [
        {
          candidate: { name: "Widget", brand: "Acme", modelIdentifiers: ["W1"] },
          offerGroups: order[market].map((currency, i) => ({ currency, offers: [offer(currency, 100 + i)] })),
          evidence: [],
          rejectedCounts: {},
        },
      ];
      return route.fulfill(uiStream([{ type: "start", messageId: `run-${market}` }, { type: "data-products", id: "products", data: products }, { type: "finish" }]));
    });
    await page.goto("/");
    for (const [market, label] of [["US", /United States/], ["SG", /Singapore/], ["JP", /Japan/]] as const) {
      await chooseMarket(page, label);
      await ask(page, `widget ${market}`);
      await expect(page.getByTestId("turn").last().getByTestId("offer-table").first().locator("caption")).toHaveText(`Prices in ${order[market][0]}`);
    }
  });
});

// Item 5: accessibility.
test.describe("5. accessibility", () => {
  const seriousOrCritical = async (page: Page) =>
    (await new AxeBuilder({ page }).analyze()).violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help} [${v.nodes.map((n) => n.target.join(" ")).join(" | ")}]`);

  test("axe: no serious or critical violations on empty, running, completed, and error states", async ({ page }) => {
    await page.goto("/?scenario=cancel-offers");
    await expect(page.getByRole("heading", { name: "Ask a shopping question" })).toBeVisible();
    expect(await seriousOrCritical(page)).toEqual([]);

    await ask(page);
    await expect(page.locator('[data-stage="offers"]')).toHaveAttribute("data-status", "running");
    expect(await seriousOrCritical(page)).toEqual([]);

    await page.evaluate(() => localStorage.clear());
    await page.goto("/?scenario=xm5-us");
    await ask(page);
    await finished(page);
    await page.getByRole("button", { name: /Used \d+ sources/ }).click();
    expect(await seriousOrCritical(page)).toEqual([]);

    await page.goto("/?scenario=error-402");
    await ask(page);
    await expect(page.getByTestId("run-error")).toBeVisible();
    expect(await seriousOrCritical(page)).toEqual([]);
  });

  test("axe: the confirmation dialog is clean too", async ({ page }) => {
    await page.goto("/");
    await ask(page);
    await finished(page);
    await page.getByRole("button", { name: "Clear history" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    // Axe reads colors mid-fade otherwise.
    await page.getByRole("alertdialog").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    expect(await seriousOrCritical(page)).toEqual([]);
  });

  test("the whole journey works with the keyboard only", async ({ page }) => {
    const focused = () => page.evaluate(() => (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim());
    const tabTo = async (label: RegExp, key = "Tab") => {
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press(key);
        if (label.test(await focused())) return;
      }
      throw new Error(`focus never reached ${label}`);
    };

    await page.goto("/?scenario=xm5-sg");
    await tabTo(/^Question$/);
    await page.keyboard.type(Q1);
    await page.keyboard.press("Enter");
    await finished(page);
    await expect(page.getByTestId("turn")).toHaveAttribute("data-state", "completed");

    // Market: open the list with the keyboard, pick Japan, and the choice is stored.
    await tabTo(/^Market$/, "Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(":focus")).toContainText("Singapore");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(":focus")).toContainText("Japan");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("market-select")).toContainText("Japan");
    expect(await stored(page, MARKET_KEY)).toBe("JP");

    // Clear history: reach the button, open the dialog, confirm, all from the keyboard.
    await tabTo(/^Clear history$/, "Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await tabTo(/^Clear history$/);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("turn")).toHaveCount(0);
    expect(await stored(page, HISTORY_KEY)).toBeNull();
  });

  test("progress changes are announced through an ARIA live region", async ({ page }) => {
    // The fixture server replays a run in milliseconds, so a staged stream stands in for a slow one.
    await page.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      const stage = (name: string, status: string) => ({ type: "data-progress", id: name, data: { stage: name, status } });
      const chunks = [
        { type: "start", messageId: "run-1" },
        ...["candidates", "offers", "validate", "compare"].flatMap((name) => [stage(name, "running"), stage(name, "done")]),
        { type: "data-usage", id: "usage", data: { exaRequests: 1, cacheHits: 0, costDollars: 0, monthRequests: 1, monthLimit: 400 } },
        { type: "finish" },
      ];
      window.fetch = (input, init) => {
        if (!String(input instanceof Request ? input.url : input).endsWith("/api/chat")) return realFetch(input, init);
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          async start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              await new Promise((r) => setTimeout(r, 120));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } }));
      };
    });
    await page.goto("/");
    const live = page.getByTestId("announcer");
    await expect(live).toHaveAttribute("role", "status");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await live.evaluate((el) => {
      const seen: string[] = [];
      (window as unknown as { __announced: string[] }).__announced = seen;
      new MutationObserver(() => {
        const text = el.textContent ?? "";
        if (text && seen.at(-1) !== text) seen.push(text);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await ask(page);
    await expect(live).toHaveText("Research complete.");
    const announced = await page.evaluate(() => (window as unknown as { __announced: string[] }).__announced);
    expect(announced).toEqual(["Research started.", "Finding candidates.", "Gathering offers.", "Validating offers.", "Writing the comparison.", "Research complete."]);
  });
});

// Item 6: layout.
test("6. at 375 px there is no horizontal page scroll and the offer table scrolls within its container", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await ask(page);
  await finished(page);
  const layout = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="offer-table"]')!.closest('[data-slot="table-container"]') as HTMLElement;
    const product = document.querySelector('[data-testid="product"]')!.getBoundingClientRect();
    return {
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      productRight: product.right,
      containerClient: container.clientWidth,
      containerScroll: container.scrollWidth,
      overflowX: getComputedStyle(container).overflowX,
    };
  });
  expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.productRight).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.containerScroll).toBeGreaterThan(layout.containerClient);
  expect(["auto", "scroll"]).toContain(layout.overflowX);
  await expect(page.getByTestId("offer-row").first().getByRole("link", { name: /View .* at / })).toBeAttached();
  await expect(page.getByTestId("market-select")).toBeVisible();
  await expect(question(page)).toBeVisible();
});

// Item 7: secrets.
test("7. after the journey no storage value contains the test key", async ({ page }) => {
  await page.goto("/");
  await chooseMarket(page, /Singapore/);
  await ask(page);
  await finished(page);
  await page.reload();
  await expect(page.getByTestId("turn")).toHaveCount(1);
  const dump = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(Object.keys(dump.local).sort()).toEqual([HISTORY_KEY, MARKET_KEY]);
  expect(Object.keys(dump.session)).toEqual([]);
  expect(JSON.stringify(dump)).not.toContain(TEST_EXA_KEY);
  expect(JSON.stringify(dump)).not.toMatch(/exa-test-key|EXA_API_KEY/i);
  const html = await page.content();
  expect(html).not.toContain(TEST_EXA_KEY);
});

// Item 8: component integrity.
test("8. components match the lock written when the shadcn CLI installed them", () => {
  expect(() => execFileSync("node", ["scripts/check-components.mjs"], { cwd: root, stdio: "pipe" })).not.toThrow();
});
