import Exa from "exa-js";
import type { Candidate, Market } from "../core/types";
import type { BudgetToken, RequestBudget } from "./budget";
import { StoredAnswerSchema, StoredSearchSchema } from "./cache";
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import { guarded } from "./guard";
import type { GuardDeps } from "./guard";
import { parseAnswerResponse, parseSearchResponse } from "./parse";
import type { AnswerResult, ExaPort, SearchResult } from "./port";
import { buildAnswerRequest, buildSearchRequest, cacheKey } from "./requests";
import type { AnswerMarketMode } from "./requests";

export const EXA_CALL_TIMEOUT_MS = 30_000;

interface CallOptions {
  signal: AbortSignal;
  timeout: number;
}

/** The two SDK methods the port uses. Tests pass a fake; production passes `Exa` through `fromApiKey`. */
export interface ExaClientLike {
  answer(query: string, options: Record<string, unknown>, call: CallOptions): Promise<unknown>;
  search(query: string, options: Record<string, unknown>, call: CallOptions): Promise<unknown>;
}

export interface SdkPortOptions extends GuardDeps {
  client: ExaClientLike;
  clock?: Clock;
  timeoutMs?: number;
  /** Where /answer gets the market from; `userLocation` on /answer is unverified until the live smoke. */
  answerMarketMode?: AnswerMarketMode;
}

/** The only module that imports `exa-js`. It holds a client, never the API key. */
export class ExaSdkPort implements ExaPort {
  readonly #client: ExaClientLike;
  readonly #deps: GuardDeps;
  readonly #clock: Clock;
  readonly #timeoutMs: number;
  readonly #answerMode: AnswerMarketMode;

  constructor(options: SdkPortOptions) {
    this.#client = options.client;
    this.#deps = { cache: options.cache, ledger: options.ledger };
    this.#clock = options.clock ?? systemClock;
    this.#timeoutMs = options.timeoutMs ?? EXA_CALL_TIMEOUT_MS;
    this.#answerMode = options.answerMarketMode ?? "userLocation";
  }

  /** The key goes to the SDK constructor and nowhere else. */
  static fromApiKey(apiKey: string, options: Omit<SdkPortOptions, "client"> = {}): ExaSdkPort {
    const exa = new Exa(apiKey);
    const client: ExaClientLike = {
      answer: (query, opts, call) => exa.answer(query, opts, call),
      search: (query, opts, call) => exa.search(query, opts as never, call),
    };
    return new ExaSdkPort({ ...options, client });
  }

  answerCandidates(question: string, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<AnswerResult> {
    const request = buildAnswerRequest(question, market, this.#answerMode);
    const { query, ...options } = request;
    return guarded(this.#deps, {
      key: cacheKey("/answer", request, market),
      schema: StoredAnswerSchema,
      budget,
      signal,
      call: async (token) => {
        const raw = await this.#invoke(token, () => this.#client.answer(query, options, { signal, timeout: this.#timeoutMs }));
        return { ...parseAnswerResponse(raw), retrievedAt: this.#clock().toISOString() };
      },
    });
  }

  searchOffers(candidate: Candidate, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<SearchResult> {
    const request = buildSearchRequest(candidate, market);
    return guarded(this.#deps, {
      key: cacheKey("/search", request, market),
      schema: StoredSearchSchema,
      budget,
      signal,
      call: async (token) => {
        const raw = await this.#invoke(token, () =>
          this.#client.search(request.query, request.options, { signal, timeout: this.#timeoutMs }),
        );
        const parsed = parseSearchResponse(raw);
        const retrievedAt = this.#clock().toISOString();
        return {
          hits: parsed.hits.map((hit) => ({ ...hit, retrievedAt })),
          exaRequestId: parsed.exaRequestId,
          costDollars: parsed.costDollars,
          retrievedAt,
        };
      },
    });
  }

  /** The SDK is reachable only through here, and `_token` makes a reserved budget token a precondition. */
  #invoke<T>(_token: BudgetToken, send: () => Promise<T>): Promise<T> {
    return send();
  }
}
