import type { z } from "zod";
import type { Candidate, Market } from "../core/types";
import type { RequestBudget } from "./budget";
import type { DiskCache } from "./cache";
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import { ExaFailure, mapExaError } from "./errors";
import type { UsageLedger } from "./ledger";
import { parseAnswerResponse, parseSearchResponse, readBilling } from "./parse";
import type { AnswerResult, ExaPort, SearchResult } from "./port";
import { buildAnswerRequest, buildSearchRequest, cacheKey } from "./requests";
import type { AnswerMarketMode, AnswerRequest, SearchRequest } from "./requests";
import { StoredAnswerSchema, StoredSearchSchema } from "./schemas";

/**
 * The only way to reach Exa, live or replayed. The port hands a transport a request only after the
 * cache missed, the ledger allowed it, and the run's budget issued a token.
 */
export interface ExaTransport {
  answer(request: AnswerRequest, signal: AbortSignal): Promise<unknown>;
  search(request: SearchRequest, signal: AbortSignal): Promise<unknown>;
}

export interface PortOptions {
  cache?: DiskCache;
  ledger?: UsageLedger;
  /** The one clock: stamps `retrievedAt`, and is passed to the cache and ledger. */
  clock?: Clock;
  /** Where /answer gets the market from; `userLocation` on /answer is unverified until the live smoke. */
  answerMarketMode?: AnswerMarketMode;
  /** Called with a short note when a response was billed oddly or partly dropped. Default: ignore. */
  onWarning?: (note: string) => void;
}

interface Call<T extends { costDollars: number; retrievedAt: string }> {
  key: string;
  schema: z.ZodType<T>;
  budget: RequestBudget;
  signal: AbortSignal;
  send: () => Promise<unknown>;
  /** Strict parse of the body; cost and time are added by the guard. */
  parse: (raw: unknown) => Omit<T, "costDollars" | "retrievedAt">;
}

/**
 * Request building, cache key, and the spend guard for every Exa call, in this order: cache hit
 * (no token, no ledger request), abort check, ledger limits, budget token, request counted, transport,
 * cost counted, strict parse, stamp, cache write. The cost of any received response is counted
 * before its body is parsed, so a billed but unusable response still costs the month. A credit
 * error marks the month exhausted. A failed cache write loses only the cache entry.
 */
export class GuardedExaPort implements ExaPort {
  readonly #transport: ExaTransport;
  readonly #cache: DiskCache | undefined;
  readonly #ledger: UsageLedger | undefined;
  readonly #clock: Clock;
  readonly #answerMode: AnswerMarketMode;
  readonly #warn: (note: string) => void;

  constructor(transport: ExaTransport, options: PortOptions = {}) {
    this.#transport = transport;
    this.#cache = options.cache;
    this.#ledger = options.ledger;
    this.#clock = options.clock ?? systemClock;
    this.#answerMode = options.answerMarketMode ?? "userLocation";
    this.#warn = options.onWarning ?? (() => {});
  }

  answerCandidates(question: string, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<AnswerResult> {
    const request = buildAnswerRequest(question, market, this.#answerMode);
    return this.#guarded({
      key: cacheKey("/answer", request, market),
      schema: StoredAnswerSchema,
      budget,
      signal,
      send: () => this.#transport.answer(request, signal),
      parse: parseAnswerResponse,
    });
  }

  searchOffers(candidate: Candidate, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<SearchResult> {
    const request = buildSearchRequest(candidate, market);
    return this.#guarded({
      key: cacheKey("/search", request, market),
      schema: StoredSearchSchema,
      budget,
      signal,
      send: () => this.#transport.search(request, signal),
      parse: (raw) => {
        const { hits, exaRequestId, skipped } = parseSearchResponse(raw);
        if (skipped > 0) this.#warn(`Skipped ${skipped} malformed search result row(s).`);
        const retrievedAt = this.#clock().toISOString();
        return { hits: hits.map((hit) => ({ ...hit, retrievedAt })), exaRequestId };
      },
    });
  }

  async #guarded<T extends { costDollars: number; retrievedAt: string }>(call: Call<T>): Promise<T & { cached: boolean }> {
    const hit = this.#cache?.get(call.key, call.schema, this.#clock());
    if (hit) return { ...hit, costDollars: 0, cached: true };

    if (call.signal.aborted) throw new ExaFailure("timeout", "The Exa request was aborted before it started.");
    this.#ledger?.assertCanCall(this.#clock());
    call.budget.take();
    this.#ledger?.recordRequest(this.#clock());

    let raw: unknown;
    try {
      raw = await call.send();
    } catch (error) {
      const failure = mapExaError(error);
      if (failure.kind === "credits_exhausted") this.#ledger?.markExhausted(this.#clock());
      throw failure;
    }

    const billing = readBilling(raw);
    if (!billing.costReported) this.#warn("Exa response carried no costDollars.total; recorded as 0.");
    this.#ledger?.recordCost(billing.costDollars, this.#clock());

    const body = call.parse(raw);
    const result = { ...body, costDollars: billing.costDollars, retrievedAt: this.#clock().toISOString() } as T;
    try {
      this.#cache?.set(call.key, result);
    } catch {
      this.#warn("Could not write the response to the cache.");
    }
    return { ...result, cached: false };
  }
}
