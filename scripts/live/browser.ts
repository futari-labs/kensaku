// Drives one EV-016 query through the built app in Chromium the way a user does: select the market, type the question,
// wait for the terminal state, wait for the images, open the "Other markets" lists, then read what the page shows.
import type { Browser, Response } from "@playwright/test";
import type { Market } from "../../src/core/types";
import { MARKET_LABEL } from "../../src/web/app/markets";
import type { UiSnapshot } from "./types";

const TERMINAL_TIMEOUT_MS = 150_000;
const IMAGES_SETTLE_MS = 30_000;

export interface ImageReply {
  id: string;
  status: number;
  contentType: string | null;
  /** The body exactly as the proxy served it; null when the browser could not read it. */
  body: Buffer | null;
}

export interface Capture {
  /** The turn's `data-state` at the end, or `timeout`. */
  turnState: string;
  chatStatus: number | null;
  chatBody: string;
  imageReplies: ImageReply[];
  origins: string[];
  requestCount: number;
  ui: UiSnapshot;
  screenshot: Buffer;
}

/** The stream's bytes decoded as UTF-8; `Response.text()` can fall back to a legacy charset and turn `®` into `Â®`. */
export async function decodeChatBody(response: { body(): Promise<Buffer> }): Promise<string> {
  return (await response.body()).toString("utf8");
}

/**
 * Runs in the page: reads the rendered cards into plain data (the shape of `UiSnapshot` without `turnState`). It is source text,
 * not a function, because tsx's esbuild wraps named functions in a helper that does not exist in the page.
 */
const READ_PAGE = `(() => {
  const text = (el) => ((el && el.textContent) || "").replace(/\\s+/g, " ").trim();
  const rows = (root, placement) =>
    [...(root ? root.querySelectorAll('[data-testid="offer-row"]') : [])].map((row) => ({
      host: text(row.querySelector('[data-slot="item-title"]')),
      price: text(row.querySelector(".tabular-nums")),
      availability: text(row.querySelector('[data-slot="badge"]')),
      line: text(row.querySelector('[data-slot="item-description"]')),
      href: (row.querySelector("a") || {}).href || "",
      placement,
    }));
  return {
    comparison: [...document.querySelectorAll('[data-testid="comparison-paragraph"]')].map((p) => text(p)),
    comparisonNote: document.querySelector('section[aria-labelledby="comparison-heading"] [data-testid="malformed-note"]') !== null,
    products: [...document.querySelectorAll('[data-testid="product"]')].map((card) => {
      const figure = card.querySelector('[data-testid="product-image"]');
      const img = figure && figure.querySelector("img");
      const reason = card.querySelector('[data-testid="reason"]');
      const loaded = figure && figure.getAttribute("data-loaded") === "true";
      return {
        title: text(card.querySelector("h3")),
        image: {
          state: card.querySelector('[data-testid="no-image"]') ? "fallback" : loaded ? "loaded" : "pending",
          src: img ? img.getAttribute("src") : null,
          caption: text(card.querySelector('[data-testid="image-caption"]')),
        },
        reason: reason ? { text: text(reason.querySelector("p")), note: reason.querySelector('[data-testid="malformed-note"]') !== null } : null,
        offers: [...rows(card.querySelector('[data-testid="offers"]'), "main"), ...rows(card.querySelector('[data-testid="other-markets"]'), "other-markets")],
      };
    }),
  };
})()`;

/** Plays the query in a fresh browser context (so no history and no cached image) and returns what the page did and showed. */
export async function captureQuery(browser: Browser, baseUrl: string, market: Market, question: string): Promise<Capture> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const origins = new Set<string>();
    let requestCount = 0;
    context.on("request", (request) => {
      requestCount++;
      const { protocol, origin } = new URL(request.url());
      if (protocol === "http:" || protocol === "https:" || protocol === "ws:" || protocol === "wss:") origins.add(origin);
    });
    let chat: Response | undefined;
    const images: Promise<ImageReply>[] = [];
    page.on("response", (response) => {
      const { pathname } = new URL(response.url());
      if (pathname === "/api/chat" && response.request().method() === "POST") chat = response;
      if (pathname.startsWith("/api/image/")) {
        images.push(
          response.body().then(
            (body) => ({ id: pathname.slice("/api/image/".length), status: response.status(), contentType: response.headers()["content-type"] ?? null, body }),
            () => ({ id: pathname.slice("/api/image/".length), status: response.status(), contentType: response.headers()["content-type"] ?? null, body: null }),
          ),
        );
      }
    });

    await page.goto(baseUrl);
    await page.getByTestId("market-select").click();
    await page.getByRole("option", { name: MARKET_LABEL[market] }).click();
    const box = page.getByRole("textbox", { name: "Question" });
    await box.fill(question);
    await box.press("Enter");

    let turnState = "timeout";
    try {
      const done = await page.waitForFunction(
        () => {
          const state = document.querySelector('[data-testid="turn"]')?.getAttribute("data-state");
          return state && state !== "running" ? state : false;
        },
        null,
        { timeout: TERMINAL_TIMEOUT_MS },
      );
      turnState = String(await done.jsonValue());
    } catch {
      // Stays `timeout`: the page never reached a terminal state.
    }

    // Every card shows a loaded image or the fallback panel once its candidates have been tried.
    await page
      .waitForFunction(
        () => [...document.querySelectorAll('[data-testid="product-image"]')].every((f) => f.getAttribute("data-loaded") === "true" || f.querySelector('[data-testid="no-image"]') !== null),
        null,
        { timeout: IMAGES_SETTLE_MS },
      )
      .catch(() => {});

    for (const trigger of await page.locator('[data-testid="other-markets"] > button').all()) await trigger.click();
    await page.waitForTimeout(300);

    const ui: UiSnapshot = { turnState, ...((await page.evaluate(READ_PAGE)) as Omit<UiSnapshot, "turnState">) };
    const screenshot = await page.screenshot({ fullPage: true });
    const replies = await Promise.all(images);
    return {
      turnState,
      chatStatus: chat?.status() ?? null,
      chatBody: chat ? await decodeChatBody(chat).catch(() => "") : "",
      imageReplies: replies,
      origins: [...origins].sort(),
      requestCount,
      ui,
      screenshot,
    };
  } finally {
    await context.close();
  }
}
