// EV-010 theme (EVALUATION_PLAN "Theme (EV-010)" checks 1-8), Chromium against `pnpm start` in fixture mode.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Q1 } from "../fixtures/questions";

const root = join(import.meta.dirname, "../..");
const THEME_KEY = "kensaku.theme.v1";

const toggle = (page: Page, name: "Switch to light theme" | "Switch to dark theme") => page.getByRole("button", { name });
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), THEME_KEY);
const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains("dark"));
const colorScheme = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** The browser's own resolution of `--background` under the given theme: the html class is set to that theme for a probe and put back. */
const backgroundOf = (page: Page, theme: "dark" | "light") =>
  page.evaluate((t) => {
    const html = document.documentElement;
    const had = html.classList.contains("dark");
    html.classList.toggle("dark", t === "dark");
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--background)";
    document.body.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    html.classList.toggle("dark", had);
    return resolved;
  }, theme);

const presetLight = (page: Page) => page.addInitScript((k) => localStorage.setItem(k, "light"), THEME_KEY);

const ask = async (page: Page) => {
  await expect(page.getByTestId("fixture-banner")).toBeVisible();
  const box = page.getByRole("textbox", { name: "Question" });
  await box.fill(Q1);
  await box.press("Enter");
};

const clearHistory = (page: Page) =>
  page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("kensaku.history")) localStorage.removeItem(k);
  });

test.use({ colorScheme: "light" });

test("1. default: fresh context emulating a light OS preference renders dark", async ({ page }) => {
  await page.goto("/");
  expect(await isDark(page)).toBe(true);
  expect(await colorScheme(page)).toBe("dark");
  const dark = await backgroundOf(page, "dark");
  expect(dark).not.toBe(await backgroundOf(page, "light"));
  expect(await bodyBackground(page)).toBe(dark);
});

test.describe("2. no flash, before the bundle", () => {
  const delayBundle = (page: Page) =>
    page.route(/\/assets\/[^/]+\.js$/, async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
  // theme-init.js has run once it has set color-scheme; the bundle has not run while #root is empty.
  const beforeBundle = async (page: Page) => {
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForFunction(() => document.documentElement.style.colorScheme !== "");
    expect(await page.evaluate(() => document.getElementById("root")?.childElementCount ?? -1)).toBe(0);
  };

  test("empty storage: dark class and dark background", async ({ page }) => {
    await delayBundle(page);
    await beforeBundle(page);
    expect(await isDark(page)).toBe(true);
    expect(await bodyBackground(page)).toBe(await backgroundOf(page, "dark"));
  });

  test("stored light: no dark class and a light background", async ({ page }) => {
    await presetLight(page);
    await delayBundle(page);
    await beforeBundle(page);
    expect(await isDark(page)).toBe(false);
    expect(await colorScheme(page)).toBe("light");
    const light = await backgroundOf(page, "light");
    expect(light).not.toBe(await backgroundOf(page, "dark"));
    expect(await bodyBackground(page)).toBe(light);
  });
});

test.describe("3. no flash, through load", () => {
  // The observer starts before any page script. Its first entry is the class before theme-init.js, so it is skipped; every later change is checked.
  const record = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __before: boolean[] };
      w.__before = [];
      // document.documentElement may not exist yet when this runs, so observe the document. Each record keeps the class list as it was before that change.
      new MutationObserver((records) => {
        for (const r of records) if (r.target === document.documentElement) w.__before.push((r.oldValue ?? "").split(/\s+/).includes("dark"));
      }).observe(document, { attributes: true, attributeFilter: ["class"], attributeOldValue: true, subtree: true });
    });
  // Every state <html> held from the end of the first change (theme-init.js) on: the old value of each later change, then the current one.
  const history = (page: Page) =>
    page.evaluate(() => {
      const before = (window as unknown as { __before: boolean[] }).__before;
      return [...before.slice(1), document.documentElement.classList.contains("dark")];
    });

  test("empty storage: never without dark", async ({ page }) => {
    await record(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Ask a shopping question" })).toBeVisible();
    const seen = await history(page);
    expect(seen.every(Boolean)).toBe(true);
    expect(await isDark(page)).toBe(true);
  });

  test("stored light: never with dark", async ({ page }) => {
    await presetLight(page);
    await record(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Ask a shopping question" })).toBeVisible();
    expect((await history(page)).some(Boolean)).toBe(false);
    expect(await isDark(page)).toBe(false);
  });
});

test("4. toggle: keyboard then mouse, with name change and storage", async ({ page }) => {
  await page.goto("/");
  const toLight = toggle(page, "Switch to light theme");
  await expect(toLight).toBeVisible();
  await page.locator("body").focus();
  for (let i = 0; i < 4 && !(await toLight.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(toLight).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await isDark(page)).toBe(false);
  expect(await colorScheme(page)).toBe("light");
  expect(await stored(page)).toBe("light");
  await expect(toggle(page, "Switch to dark theme")).toBeVisible();
  await expect(toggle(page, "Switch to light theme")).toHaveCount(0);

  await toggle(page, "Switch to dark theme").click();
  expect(await isDark(page)).toBe(true);
  expect(await colorScheme(page)).toBe("dark");
  expect(await stored(page)).toBe("dark");
  await expect(toggle(page, "Switch to light theme")).toBeVisible();
});

test("5. persistence: reload and a new page in the same context", async ({ page, context }) => {
  await page.goto("/");
  await toggle(page, "Switch to light theme").click();
  await page.reload();
  expect(await isDark(page)).toBe(false);
  await expect(toggle(page, "Switch to dark theme")).toBeVisible();
  const second = await context.newPage();
  await second.goto("/");
  expect(await isDark(second)).toBe(false);
  await expect(toggle(second, "Switch to dark theme")).toBeVisible();
});

test.describe("6. fallbacks", () => {
  test("a stored value of blue renders dark", async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, "blue"), THEME_KEY);
    await page.goto("/");
    expect(await isDark(page)).toBe(true);
    await expect(toggle(page, "Switch to light theme")).toBeVisible();
  });

  test("throwing localStorage renders dark, still toggles, and logs no uncaught error", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (e) => uncaught.push(e.message));
    await page.addInitScript(() => {
      const fail = () => {
        throw new DOMException("denied", "SecurityError");
      };
      Object.defineProperty(window, "localStorage", { configurable: true, get: fail });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Kensaku" })).toBeVisible();
    expect(await isDark(page)).toBe(true);
    await toggle(page, "Switch to light theme").click();
    expect(await isDark(page)).toBe(false);
    await expect(toggle(page, "Switch to dark theme")).toBeVisible();
    await toggle(page, "Switch to dark theme").click();
    expect(await isDark(page)).toBe(true);
    expect(uncaught).toEqual([]);
  });
});

test.describe("7. accessibility in both themes", () => {
  const seriousOrCritical = async (page: Page) => {
    // Axe reads colors mid-transition otherwise.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const { violations } = await new AxeBuilder({ page }).analyze();
    return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help} [${v.nodes.map((n) => n.target.join(" ")).join(" | ")}]`);
  };

  for (const theme of ["dark", "light"] as const) {
    test(`${theme}: empty, running, completed, and error states`, async ({ page }) => {
      if (theme === "light") await presetLight(page);
      const check = async () => {
        expect(await isDark(page)).toBe(theme === "dark");
        expect(await seriousOrCritical(page)).toEqual([]);
      };

      await page.goto("/?scenario=cancel-offers");
      await expect(page.getByRole("heading", { name: "Ask a shopping question" })).toBeVisible();
      await check();

      await ask(page);
      await expect(page.locator('[data-stage="offers"]')).toHaveAttribute("data-status", "running");
      await check();

      await clearHistory(page);
      await page.goto("/?scenario=xm5-sg");
      await ask(page);
      await expect(page.getByTestId("usage").last()).toBeVisible();
      await check();

      await clearHistory(page);
      await page.goto("/?scenario=error-402");
      await ask(page);
      await expect(page.getByTestId("run-error")).toBeVisible();
      await check();
    });
  }
});

test("8. theming convention: only the dark class and color-scheme, no inline colours", async ({ page }) => {
  await page.goto("/");
  for (const choose of ["Switch to light theme", "Switch to dark theme"] as const) {
    await toggle(page, choose).click();
    const style = await page.evaluate(() => document.documentElement.getAttribute("style") ?? "");
    expect(style).toMatch(/^\s*color-scheme:\s*(dark|light);?\s*$/);
    expect(await page.evaluate(() => document.body.getAttribute("style"))).toBeNull();
  }
  for (const file of ["public/theme-init.js", "src/web/app/theme.ts", "src/web/app/ThemeToggle.tsx"]) {
    const source = readFileSync(join(root, file), "utf8");
    expect(source, file).not.toMatch(/style\.(color|background)\b|setProperty|backgroundColor/);
  }
});
