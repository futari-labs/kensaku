import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const STRIPE_IMPORT = /(?:from|import|require)\s*\(?\s*["']stripe(?:\/[^"']*)?["']/;

describe("Stripe SDK boundary", () => {
  it("is imported only by src/commerce/stripe-port.ts", () => {
    const files = execFileSync("git", ["ls-files", "-z", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((file) => /\.(?:ts|tsx|js|mjs|cjs)$/.test(file) && file !== "src/commerce/stripe-port.ts");
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => STRIPE_IMPORT.test(readFileSync(join(ROOT, file), "utf8")))).toEqual([]);
  });

  it("the pattern catches static, type, side-effect, require and dynamic imports", () => {
    for (const line of ['import Stripe from "stripe";', "import type { Stripe } from 'stripe';", 'import "stripe";', 'const s = require("stripe");', 'await import("stripe/cjs/x")']) {
      expect(STRIPE_IMPORT.test(line)).toBe(true);
    }
    expect(STRIPE_IMPORT.test('import x from "./stripe-port";')).toBe(false);
  });
});
