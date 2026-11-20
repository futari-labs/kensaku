import { randomUUID } from "node:crypto";
import { classifyHit, rankOffers, resolveCitations } from "../core";
import type { Candidate, Evidence, Market, Offer, RejectCategory, SearchHit } from "../core/types";
import { RequestBudget, MAX_EXA_REQUESTS_PER_RUN } from "../exa/budget";
import { ExaFailure, mapExaError } from "../exa/errors";
import type { ExaFailureKind } from "../exa/errors";
import type { ExaPort } from "../exa/port";
import type { ProductResult, RunErrorKind, RunEvent, RunInput, RunUsage, SourceRef, Stage } from "./events";

export const CALL_TIMEOUT_MS = 30_000;
export const RUN_TIMEOUT_MS = 90_000;
const RETRY_BACKOFF_MS = 500;
const RETRY_AFTER_CAP_MS = 5_000;
const RATE_LIMIT_FALLBACK_MS = 1_000;
const NOT_SEARCHED_BUDGET = "Not searched: per-question request limit reached";
const MARKER = /\[(\d+(?:,\d+)*)\]/g;

export interface RunOptions {
  runId?: string;
  /** One JSON-able line per stage and per Exa call. Never receives a key or a header. */
  log?: (line: Record<string, unknown>) => void;
  callTimeoutMs?: number;
  runTimeoutMs?: number;
  /** Waits before the retry; rejects when the signal aborts. Tests pass an instant one. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  clock?: () => number;
}

/** Maps an Exa failure to the error the user sees. `budget_exhausted` has none: it ends the offers stage early instead. */
export function userErrorKind(kind: ExaFailureKind): RunErrorKind | undefined {
  switch (kind) {
    case "auth":
    case "credits_exhausted":
    case "monthly_limit":
    case "rate_limited":
    case "upstream":
    case "timeout":
      return kind;
    case "budget_exhausted":
      return undefined;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

class Cancelled extends Error {}

const emptyRejected = (): Record<RejectCategory, number> => ({
  "irrelevant-product": 0,
  "unsupported-currency": 0,
  "url-not-from-run": 0,
  "invalid-url": 0,
});

interface Searched {
  candidate: Candidate;
  hits: SearchHit[];
  retrievedAt: string;
  /** Set instead of `hits` when this candidate has no results. */
  notSearched?: string;
}

interface Classified {
  candidate: Candidate;
  offers: Offer[];
  evidence: Evidence[];
  rejectedCounts: Record<RejectCategory, number>;
  notSearched?: string;
}

function classifyAll(searched: Searched, runUrls: ReadonlySet<string>): Classified {
  const out: Classified = { candidate: searched.candidate, offers: [], evidence: [], rejectedCounts: emptyRejected() };
  if (searched.notSearched !== undefined) out.notSearched = searched.notSearched;
  for (const hit of searched.hits) {
    const result = classifyHit(hit, searched.candidate, runUrls);
    if (result.kind === "merchant-offer") out.offers.push(result);
    else if (result.kind === "evidence") out.evidence.push(result);
    else out.rejectedCounts[result.category]++;
  }
  return out;
}

/** Ranks per candidate; an offer URL already shown for an earlier candidate is not shown again. */
function validate(classified: Classified[], market: Market): ProductResult[] {
  const shown = new Set<string>();
  return classified.map((c) => {
    const fresh = c.offers.filter((offer) => !shown.has(offer.canonicalUrl));
    for (const offer of fresh) shown.add(offer.canonicalUrl);
    return {
      candidate: c.candidate,
      offerGroups: rankOffers(fresh, market),
      evidence: c.evidence,
      rejectedCounts: c.rejectedCounts,
      ...(c.notSearched !== undefined && { notSearched: c.notSearched }),
    };
  });
}

function sourcesFor(renderedText: string, urls: string[], citationUrls: string[]): SourceRef[] {
  const numbers = new Set<number>();
  for (const m of renderedText.matchAll(MARKER)) for (const n of m[1]!.split(",")) numbers.add(Number(n));
  return urls.map((url) => ({
    url,
    sourceId: [...numbers].filter((n) => citationUrls[n - 1] === url).sort((a, b) => a - b).join(","),
  }));
}

/**
 * The fixed research procedure (ARCHITECTURE, "Research pipeline"): candidates, offers, validate,
 * compare, with at most 5 Exa calls through one RequestBudget and at most one retry for the whole run.
 */
export async function* runResearch(input: RunInput, port: ExaPort, signal: AbortSignal, options: RunOptions = {}): AsyncGenerator<RunEvent> {
  const {
    runId = randomUUID(),
    log = () => {},
    callTimeoutMs = CALL_TIMEOUT_MS,
    runTimeoutMs = RUN_TIMEOUT_MS,
    sleep = abortableSleep,
    clock = Date.now,
  } = options;
  const { question, market } = input;
  const budget = new RequestBudget(MAX_EXA_REQUESTS_PER_RUN);
  const runSignal = AbortSignal.any([signal, AbortSignal.timeout(runTimeoutMs)]);
  const usage: RunUsage = { exaRequests: 0, cacheHits: 0, costDollars: 0 };
  let retriesLeft = 1;
  const runStart = clock();

  log({ event: "run_start", runId, market, question });

  const stageLog = (stage: Stage, status: string, started: number) =>
    log({ event: "stage", runId, stage, status, requestCount: budget.used, durationMs: clock() - started });

  async function exaCall<T extends { cached: boolean; costDollars: number }>(stage: Stage, op: string, send: (s: AbortSignal) => Promise<T>): Promise<T> {
    for (;;) {
      const started = clock();
      try {
        const result = await send(AbortSignal.any([runSignal, AbortSignal.timeout(callTimeoutMs)]));
        usage.exaRequests = budget.used;
        usage.costDollars += result.costDollars;
        if (result.cached) usage.cacheHits++;
        log({ event: "exa_call", runId, stage, op, requestCount: budget.used, cacheHit: result.cached, costDollars: result.costDollars, durationMs: clock() - started });
        return result;
      } catch (error) {
        usage.exaRequests = budget.used;
        if (signal.aborted) throw new Cancelled();
        const failure = mapExaError(error);
        log({ event: "exa_call", runId, stage, op, requestCount: budget.used, errorKind: failure.kind, durationMs: clock() - started });
        if (!canRetry(failure)) throw failure;
        retriesLeft--;
        try {
          await sleep(backoffMs(failure), runSignal);
        } catch {
          if (signal.aborted) throw new Cancelled();
          throw failure;
        }
      }
    }
  }

  function canRetry(failure: ExaFailure): boolean {
    const transient =
      failure.kind === "rate_limited" ||
      failure.kind === "timeout" ||
      (failure.kind === "upstream" && (failure.status === undefined || failure.status >= 500));
    return transient && retriesLeft > 0 && budget.used < MAX_EXA_REQUESTS_PER_RUN && !runSignal.aborted;
  }

  const backoffMs = (failure: ExaFailure): number =>
    failure.kind === "rate_limited" ? Math.min(failure.retryAfterMs ?? RATE_LIMIT_FALLBACK_MS, RETRY_AFTER_CAP_MS) : RETRY_BACKOFF_MS;

  const fail = (failure: ExaFailure, partial: boolean): RunEvent[] => {
    const kind = userErrorKind(failure.kind) ?? "upstream";
    log({ event: "run_end", runId, state: "failed", errorKind: failure.kind, requestCount: budget.used, durationMs: clock() - runStart });
    return [
      { type: "usage", usage },
      { type: "error", kind, message: failure.message, partial },
      { type: "end", state: "failed" },
    ];
  };

  try {
    // Stage 1: candidates (1 request)
    let started = clock();
    yield { type: "progress", stage: "candidates", status: "running" };
    let answer;
    try {
      answer = await exaCall("candidates", "answer", (s) => port.answerCandidates(question, market, budget, s));
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      stageLog("candidates", "failed", started);
      yield { type: "progress", stage: "candidates", status: "failed" };
      yield* fail(mapExaError(error), false);
      return;
    }
    stageLog("candidates", "done", started);
    yield { type: "progress", stage: "candidates", status: "done", detail: `${answer.candidates.length} candidate(s)` };

    const resolved = resolveCitations(answer.comparison, answer.citationUrls);
    const comparison: RunEvent = {
      type: "comparison",
      text: resolved.renderedText,
      sources: sourcesFor(resolved.renderedText, resolved.sources, answer.citationUrls),
    };

    // Stage 2: offers (1 request per candidate: 1 and 2, then 3 only if 1 and 2 found no merchant offer)
    started = clock();
    yield { type: "progress", stage: "offers", status: "running" };
    const runUrls = new Set<string>();
    const searched: Searched[] = [];
    const offersStage: { failure?: ExaFailure } = {};

    const search = async (candidate: Candidate): Promise<void> => {
      try {
        const result = await exaCall("offers", "search", (s) => port.searchOffers(candidate, market, budget, s));
        for (const hit of result.hits) runUrls.add(hit.url);
        searched.push({ candidate, hits: result.hits, retrievedAt: result.retrievedAt });
      } catch (error) {
        if (error instanceof Cancelled) throw error;
        const f = mapExaError(error);
        if (f.kind === "budget_exhausted") searched.push({ candidate, hits: [], retrievedAt: "", notSearched: NOT_SEARCHED_BUDGET });
        else {
          offersStage.failure ??= f;
          searched.push({ candidate, hits: [], retrievedAt: "", notSearched: "Search did not complete" });
        }
      }
    };

    const candidates = answer.candidates.slice(0, 3);
    await Promise.all(candidates.slice(0, 2).map(search));
    const merchantOffers = () => searched.reduce((n, s) => n + classifyAll(s, runUrls).offers.length, 0);
    const third = candidates[2];
    if (third && !offersStage.failure && merchantOffers() === 0 && budget.used < MAX_EXA_REQUESTS_PER_RUN) await search(third);
    if (third && searched.every((s) => s.candidate !== third)) {
      searched.push({ candidate: third, hits: [], retrievedAt: "", notSearched: "Not searched: an earlier candidate had offers" });
    }
    if (signal.aborted) throw new Cancelled();
    searched.sort((a, b) => candidates.indexOf(a.candidate) - candidates.indexOf(b.candidate));
    const classified = searched.map((s) => classifyAll(s, runUrls));

    const { failure } = offersStage;
    if (failure) {
      stageLog("offers", "failed", started);
      yield { type: "progress", stage: "offers", status: "failed" };
      yield comparison;
      yield { type: "products", products: validate(classified, market) };
      yield* fail(failure, true);
      return;
    }
    stageLog("offers", "done", started);
    yield { type: "progress", stage: "offers", status: "done", detail: `${searched.filter((s) => s.notSearched === undefined).length} candidate(s) searched` };

    // Stage 3: validate (no request)
    started = clock();
    yield { type: "progress", stage: "validate", status: "running" };
    yield { type: "products", products: validate(classified, market) };
    stageLog("validate", "done", started);
    yield { type: "progress", stage: "validate", status: "done" };

    // Stage 4: compare (no request)
    started = clock();
    yield { type: "progress", stage: "compare", status: "running" };
    yield comparison;
    stageLog("compare", "done", started);
    yield { type: "progress", stage: "compare", status: "done" };

    usage.exaRequests = budget.used;
    log({ event: "run_end", runId, state: "completed", requestCount: budget.used, cacheHits: usage.cacheHits, costDollars: usage.costDollars, durationMs: clock() - runStart });
    yield { type: "usage", usage };
    yield { type: "end", state: "completed" };
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    log({ event: "cancelled", runId, requestCount: budget.used, durationMs: clock() - runStart });
    yield { type: "end", state: "cancelled" };
  }
}
