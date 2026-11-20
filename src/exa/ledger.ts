import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import { ExaFailure } from "./errors";
import { writeJsonAtomic } from "./files";

export const DEFAULT_MONTHLY_REQUEST_LIMIT = 400;
export const DEFAULT_MONTHLY_COST_LIMIT = 8;

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
  clock?: Clock;
}

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
 * Monthly usage in `<dir>/YYYY-MM.json` (UTC month). Every operation re-reads the file, so deleting
 * it resets the month, and each write is atomic. A missing file is an empty month; an unreadable
 * one fails closed, because treating it as empty could let spending continue unseen.
 */
export class UsageLedger {
  readonly #dir: string;
  readonly #clock: Clock;
  readonly limits: Limits;

  constructor(options: LedgerOptions) {
    this.#dir = options.dir;
    this.#clock = options.clock ?? systemClock;
    this.limits = {
      requestLimit: options.requestLimit ?? DEFAULT_MONTHLY_REQUEST_LIMIT,
      costLimit: options.costLimit ?? DEFAULT_MONTHLY_COST_LIMIT,
    };
  }

  get month(): string {
    return this.#clock().toISOString().slice(0, 7);
  }

  get #path(): string {
    return join(this.#dir, `${this.month}.json`);
  }

  read(): LedgerMonth {
    let text: string;
    try {
      text = readFileSync(this.#path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { requests: 0, costDollars: 0 };
      throw this.#unreadable();
    }
    try {
      return LedgerSchema.parse(JSON.parse(text));
    } catch {
      throw this.#unreadable();
    }
  }

  /** Throws before any Exa call when credits are exhausted or a monthly limit would be exceeded. */
  assertCanCall(): void {
    const m = this.read();
    if (m.exhaustedAt !== undefined) {
      throw new ExaFailure(
        "credits_exhausted",
        `Exa credits were reported exhausted at ${m.exhaustedAt}. Delete ${this.#path} after adding credits, or wait for next month.`,
      );
    }
    if (m.requests + 1 > this.limits.requestLimit) {
      throw new ExaFailure("monthly_limit", `Monthly limit of ${this.limits.requestLimit} Exa requests reached.`);
    }
    if (m.costDollars >= this.limits.costLimit) {
      throw new ExaFailure("monthly_limit", `Monthly cost limit of $${this.limits.costLimit.toFixed(2)} reached.`);
    }
  }

  recordRequest(): void {
    this.#update((m) => ({ ...m, requests: m.requests + 1 }));
  }

  recordCost(dollars: number): void {
    if (dollars > 0) this.#update((m) => ({ ...m, costDollars: m.costDollars + dollars }));
  }

  markExhausted(): void {
    this.#update((m) => ({ ...m, exhaustedAt: m.exhaustedAt ?? this.#clock().toISOString() }));
  }

  #update(change: (m: LedgerMonth) => LedgerMonth): void {
    writeJsonAtomic(this.#path, change(this.read()));
  }

  #unreadable(): ExaFailure {
    return new ExaFailure("monthly_limit", `Usage ledger ${this.#path} is unreadable; fix or delete it to continue.`);
  }
}
