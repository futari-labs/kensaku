import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  // One server holds one run lock, so tests run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:8787", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:8787/api/health",
    // Never attach to a live server on 8787: e2e must run against its own fixture-mode server.
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NODE_ENV: "test", KENSAKU_EXA_MODE: "fixture" },
  },
});
