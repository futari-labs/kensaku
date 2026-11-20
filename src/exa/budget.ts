import { ExaFailure } from "./errors";

declare const tokenBrand: unique symbol;
/** Proof that one Exa request was reserved. Only RequestBudget.take() makes one. */
export type BudgetToken = { readonly [tokenBrand]: true };

export const MAX_EXA_REQUESTS_PER_RUN = 5;

export class RequestBudget {
  #used = 0;
  readonly #max: number;

  constructor(max: 5) {
    if (max !== MAX_EXA_REQUESTS_PER_RUN) {
      throw new RangeError(`RequestBudget allows exactly ${MAX_EXA_REQUESTS_PER_RUN} requests per run`);
    }
    this.#max = max;
  }

  get used(): number {
    return this.#used;
  }

  take(): BudgetToken {
    if (this.#used >= this.#max) {
      throw new ExaFailure("budget_exhausted", `Per-question limit of ${this.#max} Exa requests reached.`);
    }
    this.#used += 1;
    return Object.freeze({}) as BudgetToken;
  }
}
