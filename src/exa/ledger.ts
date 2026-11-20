import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ExaFailure } from "./errors";
import { writeJsonAtomic } from "./files";

export const DEFAULT_MONTHLY_REQUEST_LIMIT = 400;
export const DEFAULT_MONTHLY_COST_LIMIT = 8;

/**
 * Upper bound on what one call can cost, used to stop before a call that could cross the cost limit.
 * The research note (docs/futari/research/exa-2026-11-21.md) measures `/answer` at $0.005 and a
 * search at $0.007 plus $0.001 per summarized result, so Kensaku's 8-result search is about $0.015
 * (and a 10-result one $0.017). 0.02 covers that with margin; no call the app makes is dearer.
 */
export const MAX_CALL_COST_DOLLARS = 0.02;

const LedgerSchema = z.object({
  requests: z.number().int().nonnegative(),
  costDollars: z.number().nonnegative(),
  exhaustedAt: z.string().optional(),
});

export interface LedgerMonth {
  requests: number;
  costDollars: number;
  exhaustedAt?: string;
}

export interface Limits {
  requestLimit: number;
  costLimit: number;
}

export interface LedgerOptions extends Partial<Limits> {
  dir: string;
}

/** UTC month key, `YYYY-MM`. */
export const monthOf = (now: Date): string => now.toISOString().slice(0, 7);

function positive(raw: string | undefined, fallback: number): number {
  const n = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function limitsFromEnv(env: Record<string, string | undefined>): Limits {
  return {
    requestLimit: positive(env.KENSAKU_MONTHLY_REQUEST_LIMIT, DEFAULT_MONTHLY_REQUEST_LIMIT),
    costLimit: positive(env.KENSAKU_MONTHLY_COST_LIMIT, DEFAULT_MONTHLY_COST_LIMIT),
  };
}

/**
 * Monthly usage in `<dir>/YYYY-MM.json` (UTC month). Every operation takes the current time from the
 * port and re-reads the file, so deleting it resets the month, and each write is atomic. A missing
 * file is an empty month; an unreadable or unwritable one fails closed, because carrying on could
 * let spending continue unseen.
 */
export class UsageLedger {
  readonly #dir: string;
  readonly limits: Limits;

  constructor(options: LedgerOptions) {
    this.#dir = options.dir;
    this.limits = {
      requestLimit: options.requestLimit ?? DEFAULT_MONTHLY_REQUEST_LIMIT,
      costLimit: options.costLimit ?? DEFAULT_MONTHLY_COST_LIMIT,
    };
  }

  #path(now: Date): string {
    return join(this.#dir, `${monthOf(now)}.json`);
  }

  read(now: Date): LedgerMonth {
    const path = this.#path(now);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { requests: 0, costDollars: 0 };
      throw this.#unusable(path, "unreadable");
    }
    try {
      return LedgerSchema.parse(JSON.parse(text));
    } catch {
      throw this.#unusable(path, "unreadable");
    }
  }

  /**
   * Throws before any Exa call when credits are exhausted, the request limit is reached, or the next
   * call could take the month's cost past the limit (cost so far plus MAX_CALL_COST_DOLLARS).
   */
  assertCanCall(now: Date): void {
    const m = this.read(now);
    if (m.exhaustedAt !== undefined) {
      throw new ExaFailure(
        "credits_exhausted",
        `Exa credits were reported exhausted at ${m.exhaustedAt}. Delete ${this.#path(now)} after adding credits, or wait for next month.`,
      );
    }
    if (m.requests + 1 > this.limits.requestLimit) {
      throw new ExaFailure("monthly_limit", `Monthly limit of ${this.limits.requestLimit} Exa requests reached.`);
    }
    // Rounded to 1e-9 so float noise cannot flip an exact fit (7.98 + 0.02 against 8).
    if (Math.round((m.costDollars + MAX_CALL_COST_DOLLARS) * 1e9) / 1e9 > this.limits.costLimit) {
      throw new ExaFailure("monthly_limit", `Monthly cost limit of $${this.limits.costLimit.toFixed(2)} reached.`);
    }
  }

  recordRequest(now: Date): void {
    this.#update(now, (m) => ({ ...m, requests: m.requests + 1 }));
  }

  recordCost(dollars: number, now: Date): void {
    if (dollars > 0) this.#update(now, (m) => ({ ...m, costDollars: m.costDollars + dollars }));
  }

  markExhausted(now: Date): void {
    this.#update(now, (m) => ({ ...m, exhaustedAt: m.exhaustedAt ?? now.toISOString() }));
  }

  #update(now: Date, change: (m: LedgerMonth) => LedgerMonth): void {
    const path = this.#path(now);
    const next = change(this.read(now));
    try {
      writeJsonAtomic(path, next);
    } catch {
      throw this.#unusable(path, "unwritable");
    }
  }

  #unusable(path: string, what: "unreadable" | "unwritable"): ExaFailure {
    return new ExaFailure("monthly_limit", `Usage ledger ${path} is ${what}; fix or delete it to continue.`);
  }
}
