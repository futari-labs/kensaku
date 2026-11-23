// EV-015 image-first product cards (EVALUATION_PLAN "Product cards (EV-015)" checks 1-10), Chromium against `pnpm start` in fixture mode.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { ProductResult } from "../../src/research/events";
import { productTitle } from "../../src/web/app/format";
import { Q1 } from "../fixtures/questions";

const root = join(import.meta.dirname, "../..");
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));
const frozenHistory = read("evals/fixtures/history/mvp-history-xm5-sg.json") as { key: string; value: string };
const content = read("evals/cases/product-content.json") as {
  comparisonCases: { id: string; expected: { renderedText: string; sources: string[] } }[];
  cases: { id: string; candidates: { expected: { reason: { renderedText: string; sources: string[] } } }[] }[];
};
const K01 = content.comparisonCases.find((c) => c.id === "K01")!;
const P04 = content.cases.find((c) => c.id === "P04")!.candidates[0]!.expected.reason;

const HISTORY_KEY = "kensaku.history.v1";
const MARKET_KEY = "kensaku.market.v1";
const THEME_KEY = "kensaku.theme.v1";
const NOTE = "Exa's answer ended in malformed output, which is not shown.";
/** ARCHITECTURE, "Content-Security-Policy (v1.1)". */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const ORIGIN = "http://127.0.0.1:8787";

type Theme = "dark" | "light";

const question = (page: Page) => page.getByRole("textbox", { name: "Question" });
const finished = (page: Page) => expect(page.getByTestId("usage").last()).toBeVisible();
const cards = (page: Page) => page.getByTestId("product");
const setStorage = (page: Page, entries: Record<string, string>) =>
  page.evaluate((e) => Object.entries(e).forEach(([k, v]) => localStorage.setItem(k, v)), entries);

/** Opens a fixture scenario with the market and theme preset, asks Q1, and waits for the run to end. */
async function run(page: Page, scenario: string, { market = "SG", theme = "dark" }: { market?: "US" | "SG" | "JP"; theme?: Theme } = {}) {
  await page.goto("/");
  await setStorage(page, { [MARKET_KEY]: market, [THEME_KEY]: theme });
  await page.goto(`/?scenario=${scenario}`);
  await expect(page.getByTestId("fixture-banner")).toBeVisible();
  await question(page).fill(Q1);
  await question(page).press("Enter");
  await finished(page);
}

const boxOf = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;

async function settledCardBoxes(page: Page) {
  let previous = "";
  let settled: [Awaited<ReturnType<typeof boxOf>>, Awaited<ReturnType<typeof boxOf>>] | undefined;
  await expect
    .poll(async () => {
      const boxes = await Promise.all([boxOf(cards(page).nth(0)), boxOf(cards(page).nth(1))] as const);
      const reading = JSON.stringify(boxes);
      settled = reading === previous ? boxes : undefined;
      previous = reading;
      return settled !== undefined;
    })
    .toBe(true);
  return settled!;
}

/** One server-sent event of the UI message stream (the same helper shape as the EV-007 spec). */
const sseEvent = (chunk: object) => `data: ${JSON.stringify(chunk)}\n\n`;
const SSE_HEADERS = { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" };
const uiStream = (chunks: object[]) => ({ status: 200, headers: SSE_HEADERS, body: [...chunks.map(sseEvent), "data: [DONE]\n\n"].join("") });

const seriousOrCritical = async (page: Page) => {
  // Settle finite animations (a skeleton that is removed mid-wait cancels its infinite pulse, which rejects `finished`).
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

/** The products the page stored for the newest run, with their image candidates. */
const storedProducts = async (page: Page): Promise<ProductResult[]> => {
  const raw = (await page.evaluate((k) => localStorage.getItem(k), HISTORY_KEY))!;
  const messages = JSON.parse(raw).messages as { parts: { type: string; data?: ProductResult[] }[] }[];
  return messages.flatMap((m) => m.parts).find((p) => p.type === "data-products")!.data!;
};

test.describe("1. layout", () => {
  test("1280x800: two cards per row, each at least 480 px wide; full-bleed 4:3 image at least 360 px tall", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await run(page, "xm5-sg-cards");
    await expect(cards(page)).toHaveCount(2);
    const [a, b] = await settledCardBoxes(page);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2);
    expect(a.width).toBeGreaterThanOrEqual(480);
    expect(b.width).toBeGreaterThanOrEqual(480);
    expect(b.x).toBeGreaterThan(a.x + a.width - 2);
    for (const [i, card] of [a, b].entries()) {
      const image = await boxOf(cards(page).nth(i).locator('[data-slot="aspect-ratio"]'));
      expect(Math.abs(image.width - card.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(image.height - (image.width * 3) / 4)).toBeLessThanOrEqual(1);
      expect(image.height).toBeGreaterThanOrEqual(360);
    }
  });

  test("375x812: the cards stack, the image is full-bleed and at least 300 px wide, and the page does not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await run(page, "xm5-sg-cards");
    await expect(cards(page)).toHaveCount(2);
    const [a, b] = await settledCardBoxes(page);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    for (const [i, card] of [a, b].entries()) {
      const image = await boxOf(cards(page).nth(i).locator('[data-slot="aspect-ratio"]'));
      expect(Math.abs(image.width - card.width)).toBeLessThanOrEqual(2);
      expect(image.width).toBeGreaterThanOrEqual(300);
    }
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test("2. content order: heading, image with caption, price summary, specs, reason, offers, Other markets, Research details", async ({ page }) => {
  await run(page, "xm5-sg-cards");
  const card = cards(page).first();
  const order = await card.evaluate((el) => {
    const marks: [string, string][] = [
      ["heading", "h3"],
      ["image", '[data-testid="product-image"]'],
      ["summary", '[data-testid="price-summary"]'],
      ["specs", '[data-testid="key-specs"]'],
      ["reason", '[data-testid="reason"]'],
      ["offers", '[data-testid="offers"]'],
      ["other", '[data-testid="other-markets"]'],
      ["research", '[data-testid="research-details"]'],
    ];
    const found = marks.map(([name, selector]) => ({ name, node: el.querySelector(selector) }));
    const missing = found.filter((f) => !f.node).map((f) => f.name);
    const inOrder = found.every((f, i) => i === 0 || !f.node || !found[i - 1]!.node || !!(found[i - 1]!.node!.compareDocumentPosition(f.node) & Node.DOCUMENT_POSITION_FOLLOWING));
    return { missing, inOrder };
  });
  expect(order).toEqual({ missing: [], inOrder: true });
  await expect(card.getByTestId("product-image").locator("figcaption")).toBeVisible();
  const specs = card.getByTestId("key-specs").locator("li");
  expect(await specs.count()).toBeGreaterThan(0);
  expect(await specs.count()).toBeLessThanOrEqual(5);
  await expect(card.getByTestId("reason").getByRole("heading", { name: "Why it fits" })).toBeVisible();
  expect(await card.getByTestId("reason").getByTestId("inline-citation").count()).toBeGreaterThan(0);
  // Without other-currency offers there is no Other markets disclosure.
  await expect(cards(page).nth(1).getByTestId("other-markets")).toHaveCount(0);
  await expect(cards(page).nth(1).getByTestId("research-details")).toHaveCount(1);
});

test("3. the heading is the product, never a merchant; each offer shows host, name, price with code, badge, time and a named link", async ({ page }) => {
  await run(page, "xm5-sg-cards");
  const products = await storedProducts(page);
  for (const [i, product] of products.entries()) {
    const card = cards(page).nth(i);
    const heading = card.getByRole("heading", { level: 3 });
    await expect(heading).toHaveText(productTitle(product.candidate));
    const hosts = product.offerGroups.flatMap((g) => g.offers.map((o) => o.merchantHost));
    const headingText = (await heading.textContent())!;
    for (const host of hosts) expect(headingText).not.toContain(host);
  }
  const first = products[0]!;
  const offer = first.offerGroups[0]!.offers[0]!;
  const row = cards(page).first().getByTestId("offer-row").first();
  await expect(row).toContainText(offer.merchantHost);
  await expect(row).toContainText(offer.merchantName);
  await expect(row).toContainText(/\d[\d,]*\.\d\d SGD/);
  await expect(row.locator('[data-slot="badge"]')).toHaveText(/In stock|Out of stock|Preorder|Availability unknown/);
  await expect(row.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d\d-\d\dT/);
  const link = row.getByRole("link", { name: `View offer for ${offer.productName} at ${offer.merchantHost}` });
  await expect(link).toHaveAttribute("href", /^https:\/\//);
});

test.describe("4. images", () => {
  test("a skeleton shows while the image loads and the alt text is set; the I3-failing first candidate is skipped and the caption names the loaded one", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/image/*", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/");
    await setStorage(page, { [MARKET_KEY]: "SG" });
    await page.goto("/?scenario=xm5-sg-cards");
    await expect(page.getByTestId("fixture-banner")).toBeVisible();
    await question(page).fill(Q1);
    await question(page).press("Enter");
    const first = cards(page).first();
    await expect(first.getByTestId("image-skeleton")).toBeVisible();
    await expect(first.locator("img")).toHaveAttribute("alt", /^Sony WH-1000XM5 Wireless Noise Cancelling Headphones, image from .+/);
    release();
    await finished(page);

    const products = await storedProducts(page);
    for (const [i, product] of products.entries()) {
      const candidates = product.imageCandidates!;
      // The fixture maps each product's first candidate to an image that fails rule I3.
      const shown = candidates[1]!;
      const image = cards(page).nth(i).locator("img");
      await expect(image).toHaveAttribute("src", `/api/image/${shown.id}`);
      await expect(image).toHaveAttribute("alt", `${productTitle(product.candidate)}, image from ${shown.sourceHost}`);
      await expect(cards(page).nth(i).getByTestId("image-caption")).toHaveText(`Image: ${shown.sourceHost} · ${shown.sourceTitle}`);
      await expect(cards(page).nth(i).getByTestId("image-skeleton")).toHaveCount(0);
      expect(await image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
  });

  test("with no usable image each card shows 'No verified product image' at the same size, and no img is left in the error state", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await run(page, "no-images");
    const count = await cards(page).count();
    expect(count).toBeGreaterThan(0);
    await expect(page.getByTestId("no-image")).toHaveCount(count);
    for (let i = 0; i < count; i++) {
      const card = cards(page).nth(i);
      await expect(card.getByTestId("no-image")).toHaveText("No verified product image");
      const [cardBox, panel] = await Promise.all([boxOf(card), boxOf(card.locator('[data-slot="aspect-ratio"]'))]);
      expect(Math.abs(panel.width - cardBox.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(panel.height - (panel.width * 3) / 4)).toBeLessThanOrEqual(1);
      expect(panel.height).toBeGreaterThanOrEqual(360);
    }
    const broken = await page.evaluate(() => [...document.images].filter((img) => img.complete && img.naturalWidth === 0).length);
    expect(broken).toBe(0);
  });
});

test("5. the browser contacts only 127.0.0.1, and the page carries the ARCHITECTURE Content-Security-Policy", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  const response = await page.goto("/");
  expect(response!.headers()["content-security-policy"]).toBe(CSP);
  // "During every scenario": each scenario the cards use, in a market that suits it.
  const scenarios = [
    ["xm5-sg-cards", "SG"],
    ["xm5-us-cards", "US"],
    ["no-images", "SG"],
    ["no-market-offers", "SG"],
    ["comparison-truncated", "US"],
  ] as const;
  for (const [scenario, market] of scenarios) {
    await run(page, scenario, { market });
    await page.getByRole("button", { name: /Research details/ }).first().click();
  }
  expect(urls.length).toBeGreaterThan(10);
  for (const url of urls) if (/^https?:|^wss?:/.test(url)) expect(new URL(url).origin, url).toBe(ORIGIN);
});

test.describe("6. markets", () => {
  test("SG: only SGD offers in the main list, the price summary, and Other markets collapsed until the keyboard opens it", async ({ page }) => {
    await run(page, "xm5-sg-cards");
    const products = await storedProducts(page);
    const card = cards(page).first();
    const sgd = products[0]!.offerGroups.find((g) => g.currency === "SGD")!.offers;
    const lowest = Math.min(...sgd.map((o) => o.price.amount));
    const lowestText = lowest.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await expect(card.getByTestId("price-summary")).toHaveText(`From ${lowestText} SGD · ${sgd.length} Singapore ${sgd.length === 1 ? "offer" : "offers"}`);
    await expect(card.getByTestId("offers").getByTestId("offer-row")).toHaveCount(sgd.length);
    await expect(card.getByTestId("offers")).not.toContainText("USD");

    const other = products[0]!.offerGroups.filter((g) => g.currency !== "SGD").flatMap((g) => g.offers);
    expect(other).toHaveLength(1);
    const trigger = card.getByRole("button", { name: `Other markets (may not ship to Singapore) · ${other.length}` });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(card.getByTestId("other-markets").getByTestId("offer-row")).toHaveCount(0);
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const usd = card.getByTestId("other-markets").getByTestId("offer-row");
    await expect(usd).toHaveCount(1);
    await expect(usd).toContainText(/\d[\d,]*\.\d\d USD/);
    await page.keyboard.press("Space");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("SG with USD offers only: the main list reads 'No Singapore offers found' and the USD offers wait under Other markets", async ({ page }) => {
    await run(page, "no-market-offers");
    const card = cards(page).first();
    await expect(card.getByTestId("price-summary")).toHaveText("No Singapore offers found");
    await expect(card.getByTestId("offers")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /^Other markets \(may not ship to Singapore\) · \d+$/ })).toHaveAttribute("aria-expanded", "false");
  });

  test("no converted amount appears: every price is an offer's own amount with its own ISO code", async ({ page }) => {
    await run(page, "xm5-sg-cards");
    const products = await storedProducts(page);
    const amounts = new Set(products.flatMap((p) => p.offerGroups.flatMap((g) => g.offers.map((o) => o.price.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })))));
    for (const button of await page.getByRole("button", { name: /Other markets/ }).all()) await button.click();
    const shown = await cards(page).evaluateAll((els) => els.flatMap((el) => [...(el.textContent ?? "").matchAll(/(\d[\d,]*\.\d\d) (USD|SGD|JPY)\b/g)].map((m) => m[1]!)));
    expect(shown.length).toBeGreaterThan(0);
    for (const amount of shown) expect(amounts.has(amount), amount).toBe(true);
    for (const text of await cards(page).allTextContents()) expect(text).not.toMatch(/[$¥€£]|S\$/);
  });
});

test("7. Research details are collapsed by default and, opened, list each evidence item with its label and the rejected count", async ({ page }) => {
  await run(page, "xm5-sg-cards");
  const products = await storedProducts(page);
  const [index, product] = products.map((p, i) => [i, p] as const).find(([, p]) => p.evidence.length > 0)!;
  const card = cards(page).nth(index);
  const trigger = card.getByRole("button", { name: /^Research details/ });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(card.getByTestId("evidence-item")).toHaveCount(0);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByTestId("evidence-item")).toHaveCount(product.evidence.length);
  for (const [i, item] of product.evidence.entries()) {
    await expect(card.getByTestId("evidence-item").nth(i)).toContainText(item.title ?? item.url);
    await expect(card.getByTestId("evidence-item").nth(i)).toContainText(/Price aggregator|Editorial review|Not a product listing|Merchant page without a valid price|Merchant name does not match the site|Second-hand marketplace|Search or category page/);
  }
  const rejected = Object.values(product.rejectedCounts).reduce((a, b) => a + b, 0);
  await expect(card.getByTestId("research-details")).toContainText(`${rejected} search result${rejected === 1 ? " was" : "s were"} rejected`);
});

test.describe("8. history", () => {
  test("the frozen MVP payload renders as cards with the fallback image panel, no specs or reason, no reset notice and no error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [frozenHistory.key, frozenHistory.value]);
    await page.goto("/");
    await expect(cards(page).first()).toBeVisible();
    await expect(page.getByTestId("history-notice")).toHaveCount(0);
    const count = await cards(page).count();
    expect(count).toBeGreaterThan(0);
    await expect(page.getByTestId("no-image")).toHaveCount(count);
    await expect(page.getByTestId("key-specs")).toHaveCount(0);
    await expect(page.getByTestId("reason")).toHaveCount(0);
    await expect(cards(page).first().getByTestId("offer-row").first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a v1.1 run survives a reload with the same cards and image candidates", async ({ page }) => {
    await run(page, "xm5-sg-cards");
    const before = await storedProducts(page);
    const headings = await cards(page).getByRole("heading", { level: 3 }).allTextContents();
    await page.reload();
    await expect(cards(page)).toHaveCount(before.length);
    await expect(cards(page).getByRole("heading", { level: 3 })).toHaveText(headings);
    expect((await storedProducts(page)).map((p) => p.imageCandidates)).toEqual(before.map((p) => p.imageCandidates));
    await expect(cards(page).first().locator("img")).toHaveAttribute("src", `/api/image/${before[0]!.imageCandidates![1]!.id}`);
    await expect(page.getByTestId("history-notice")).toHaveCount(0);
  });
});

test.describe("9. accessibility", () => {
  for (const theme of ["dark", "light"] as const) {
    for (const scenario of ["xm5-sg-cards", "no-images"]) {
      test(`axe: no serious or critical violations in ${theme} on ${scenario}, disclosures open`, async ({ page }) => {
        await run(page, scenario, { theme });
        // Images have settled: loaded, or fallen back to the panel.
        await expect(page.locator('[data-testid="image-skeleton"]')).toHaveCount(0);
        expect(await seriousOrCritical(page)).toEqual([]);
        for (const button of await page.getByRole("button", { name: /^(Other markets|Research details)/ }).all()) await button.click();
        expect(await seriousOrCritical(page)).toEqual([]);
      });
    }
  }

  test("every card disclosure, evidence link, offer link and reason citation is reachable and operable by keyboard; image alt text follows REQ-013", async ({ page }) => {
    await run(page, "xm5-sg-cards");
    const products = await storedProducts(page);
    const focused = page.locator(":focus");
    const reach = async (selector: string) => {
      for (let i = 0; i < 200; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
      }
      throw new Error(`Tab never reached ${selector}`);
    };
    await question(page).focus();

    // Document order within the first card: reason citation, offer link, then its disclosures. Focus is only ever moved by Tab after this point.
    await reach('[data-testid="product"] [data-testid="reason"] [data-testid="inline-citation"]');
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("citation-card")).toBeVisible();
    await expect(page.getByTestId("citation-link").first()).toHaveAttribute("href", /^https:\/\//);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("citation-card")).toHaveCount(0);
    await reach('[data-testid="product"] [data-testid="offer-row"] a');

    for (const [i, product] of products.entries()) {
      const disclosures = [...(product.offerGroups.some((g) => g.currency !== "SGD") ? ["Other markets"] : []), "Research details"];
      for (const name of disclosures) {
        await reach('[data-testid="product"] [data-slot="collapsible-trigger"]');
        await expect(focused).toContainText(name);
        await expect(focused).toHaveAttribute("aria-expanded", "false");
        await page.keyboard.press("Enter");
        await expect(focused).toHaveAttribute("aria-expanded", "true");
        if (name === "Research details" && product.evidence.length > 0) {
          await reach('[data-testid="evidence-item"] a');
          await expect(cards(page).nth(i).getByTestId("evidence-item").first().locator("a")).toBeFocused();
        }
      }
    }
    for (const [i, product] of products.entries()) {
      const alt = (await cards(page).nth(i).locator("img").getAttribute("alt"))!;
      expect(alt.startsWith(`${productTitle(product.candidate)}, image from `), alt).toBe(true);
    }
  });
});

test.describe("10. the malformed-answer note (REQ-002, D-042)", () => {
  test("comparison-truncated: the K01 text with its citations and the note beside it; the card reason is cut with the note too; no brace on the page", async ({ page }) => {
    await run(page, "comparison-truncated", { market: "US" });
    // The candidate's name already starts with its brand, so the heading names the brand once (EV-015 check 3).
    await expect(cards(page).first().getByRole("heading", { level: 3 })).toHaveText("Logitech MX Vertical");
    const section = page.getByRole("region", { name: "Comparison" });
    const shown = await section.getByTestId("comparison-paragraph").evaluateAll((ps) =>
      ps.map((p) => {
        const clone = p.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('[data-testid="inline-citation"]').forEach((c) => c.remove());
        return clone.textContent ?? "";
      }),
    );
    expect(shown.join("\n\n")).toBe(K01.expected.renderedText.replace(/\[\d+(?:,\d+)*\]/g, ""));
    expect(K01.expected.renderedText.endsWith("[4,8].")).toBe(true);
    expect(await section.getByTestId("inline-citation").count()).toBe((K01.expected.renderedText.match(/\[\d+(?:,\d+)*\]/g) ?? []).length);
    // Each marker opens exactly its own K01 sources: [4] the first, [4,8] both.
    const citations = section.getByTestId("inline-citation");
    const markers = K01.expected.renderedText.match(/\[\d+(?:,\d+)*\]/g) ?? [];
    const [first, second] = K01.expected.sources;
    const expectedHrefs: Record<string, string[]> = { "[4]": [first!], "[4,8]": [first!, second!] };
    for (let i = 0; i < (await citations.count()); i++) {
      await citations.nth(i).click();
      const hrefs = await page.getByTestId("citation-link").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(hrefs.sort(), markers[i]).toEqual([...expectedHrefs[markers[i]!]!].sort());
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("citation-card")).toHaveCount(0);
    }
    await section.getByRole("button", { name: /Used 2 sources/ }).click();
    const sources = await section.getByTestId("source-link").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(sources.sort()).toEqual([...K01.expected.sources].sort());
    await expect(section.getByTestId("malformed-note")).toHaveText(NOTE);

    const reason = cards(page).first().getByTestId("reason");
    await expect(reason.getByTestId("malformed-note")).toHaveText(NOTE);
    // The reason is cut where the leaked structure began (product-content.json P04): its text is P04's rendered text, with the citation shown.
    const reasonText = await reason.locator("p").first().evaluate((p) => {
      const clone = p.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-testid="inline-citation"]').forEach((c) => c.remove());
      return clone.textContent ?? "";
    });
    expect(reasonText).toBe(P04.renderedText.replace(/\[\d+(?:,\d+)*\]/g, ""));
    expect(await reason.getByTestId("inline-citation").count()).toBe((P04.renderedText.match(/\[\d+(?:,\d+)*\]/g) ?? []).length);
    await reason.getByTestId("inline-citation").first().click();
    await expect(page.getByTestId("citation-link")).toHaveAttribute("href", P04.sources[0]!);
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toContainText(/[{}]/);
  });

  test("comparison-dropped (SYNTHETIC stream): no comparison text, the note in its place, and the cards still render", async ({ page }) => {
    // SYNTHETIC: a stubbed UI stream, not a server reply. It holds the parts the server emits when nothing readable remains of the comparison (JM-104).
    await run(page, "xm5-sg-cards");
    const products = await storedProducts(page);
    await page.evaluate(() => localStorage.removeItem("kensaku.history.v1"));
    const progress = ["candidates", "offers", "validate", "compare"].flatMap((stage) => [
      { type: "data-progress", id: stage, data: { stage, status: "running" } },
      { type: "data-progress", id: stage, data: { stage, status: "done" } },
    ]);
    await page.route("**/api/chat", (route) =>
      route.fulfill(
        uiStream([
          { type: "start", messageId: "synthetic-dropped" },
          ...progress,
          { type: "data-comparison", id: "comparison", data: { truncated: true } },
          { type: "data-products", id: "products", data: products },
          { type: "data-usage", id: "usage", data: { exaRequests: 3, cacheHits: 0, costDollars: 0, monthRequests: 3, monthLimit: 400 } },
          { type: "finish" },
        ]),
      ),
    );
    await page.goto("/");
    await expect(page.getByTestId("fixture-banner")).toBeVisible();
    await question(page).fill(Q1);
    await question(page).press("Enter");
    await finished(page);
    const section = page.getByRole("region", { name: "Comparison" });
    await expect(section.getByTestId("malformed-note")).toHaveText(NOTE);
    await expect(section.getByTestId("comparison-paragraph")).toHaveCount(0);
    await expect(cards(page)).toHaveCount(products.length);
  });

  test("xm5-sg-cards shows no note", async ({ page }) => {
    await run(page, "xm5-sg-cards");
    await expect(page.getByTestId("malformed-note")).toHaveCount(0);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`the note is axe-clean in ${theme}`, async ({ page }) => {
      await run(page, "comparison-truncated", { market: "US", theme });
      await expect(page.getByTestId("malformed-note").first()).toBeVisible();
      expect(await seriousOrCritical(page)).toEqual([]);
    });
  }
});
