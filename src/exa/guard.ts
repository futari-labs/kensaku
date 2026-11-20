import type { z } from "zod";
import type { BudgetToken, RequestBudget } from "./budget";
import type { DiskCache } from "./cache";
import { ExaFailure, mapExaError } from "./errors";
import type { UsageLedger } from "./ledger";

export interface GuardDeps {
  cache?: DiskCache;
  ledger?: UsageLedger;
}

interface Stored {
  retrievedAt: string;
  costDollars: number;
}

/**
 * The one path every Exa call takes: cache, then ledger limits, then a budget token, then the call.
 * Cache hits use no token and no ledger request. Limits are checked before a token is taken, so a
 * blocked call does not burn the run's budget. Each attempted call is counted in the ledger before
 * it starts; its reported cost is added after. A credit error marks the month exhausted.
 */
export async function guarded<T extends Stored>(
  deps: GuardDeps,
  args: {
    key: string;
    schema: z.ZodType<T>;
    budget: RequestBudget;
    signal: AbortSignal;
    call: (token: BudgetToken) => Promise<T>;
  },
): Promise<T & { cached: boolean }> {
  const hit = deps.cache?.get(args.key, args.schema);
  if (hit) return { ...hit, costDollars: 0, cached: true };

  if (args.signal.aborted) throw new ExaFailure("timeout", "The Exa request was aborted before it started.");
  deps.ledger?.assertCanCall();
  const token = args.budget.take();
  deps.ledger?.recordRequest();

  let result: T;
  try {
    result = await args.call(token);
  } catch (error) {
    const failure = mapExaError(error);
    if (failure.kind === "credits_exhausted") deps.ledger?.markExhausted();
    throw failure;
  }
  deps.ledger?.recordCost(result.costDollars);
  deps.cache?.set(args.key, result);
  return { ...result, cached: false };
}
