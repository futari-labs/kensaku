import { randomUUID } from "node:crypto";
import { classifyHit, cutLeakedStructure, normalizeKeySpecs, rankImageCandidates, rankOffers, resolveCitations, resolveReason } from "../core";
import type { Classified as ClassifiedHit } from "../core";
import type { Candidate, Evidence, ImageCandidate, ImageSource, Market, Offer, RejectCategory, SearchHit } from "../core/types";
import { RequestBudget, MAX_EXA_REQUESTS_PER_RUN } from "../exa/budget";
import { ExaFailure, mapExaError } from "../exa/errors";
import type { ExaPort } from "../exa/port";
import type { ProductResult, RunErrorKind, RunEvent, RunInput, RunUsage, Stage } from "./events";

export const CALL_TIMEOUT_MS = 30_000;
export const RUN_TIMEOUT_MS = 90_000;
const RETRY_BACKOFF_MS = 500;
const RETRY_AFTER_CAP_MS = 5_000;
const RATE_LIMIT_FALLBACK_MS = 1_000;
const NOT_SEARCHED_BUDGET = "Not searched: per-question request limit reached";
const NOT_SEARCHED_OFFERS = "Not searched: an earlier candidate had offers";
const NOT_SEARCHED_FAILED = "Not searched: an earlier search did not complete";
const SEARCH_INCOMPLETE = "Search did not complete";

export interface RunOptions {
  runId?: string;
  /** One JSON-able line per stage and per Exa call. Never receives a key or a header. */
  log?: (line: Record<string, unknown>) => void;
  callTimeoutMs?: number;
  runTimeoutMs?: number;
  /** Waits before the retry; rejects when the signal aborts. Tests pass an instant one. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  clock?: () => number;
  /** Records a product's image sources with the image proxy and returns the candidates the browser gets. Default: no images. */
  registerImages?: (sources: ImageSource[]) => ImageCandidate[];
}

/** An Exa failure the user sees as an error. `budget_exhausted` is not one: it ends the offers stage early instead. */
type RunFailure = ExaFailure & { kind: RunErrorKind };
const isRunFailure = (failure: ExaFailure): failure is RunFailure => failure.kind !== "budget_exhausted";

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

interface Classified {
  candidate: Candidate;
  offers: Offer[];
  evidence: Evidence[];
  rejectedCounts: Record<RejectCategory, number>;
  /** Every result of this candidate's search with its classification, in Exa's order (rule I2 reads it). */
  entries: ClassifiedHit[];
  /** Set when this candidate has no search results. */
  notSearched?: string;
}

/** What searching one candidate came to. */
type Searched =
  | { status: "searched"; classified: Classified }
  | { status: "not-searched"; candidate: Candidate; reason: string }
  | { status: "failed"; candidate: Candidate; failure: RunFailure };

function classifyAll(candidate: Candidate, hits: SearchHit[]): Classified {
  const runUrls = new Set(hits.map((hit) => hit.url));
  const out: Classified = { candidate, offers: [], evidence: [], rejectedCounts: emptyRejected(), entries: [] };
  for (const hit of hits) {
    const result = classifyHit(hit, candidate, runUrls);
    out.entries.push({ hit, result });
    if (result.kind === "merchant-offer") out.offers.push(result);
    else if (result.kind === "evidence") out.evidence.push(result);
    else out.rejectedCounts[result.category]++;
  }
  return out;
}

function classifiedOf(searched: Searched): Classified {
  if (searched.status === "searched") return searched.classified;
  const notSearched = searched.status === "failed" ? SEARCH_INCOMPLETE : searched.reason;
  return { candidate: searched.candidate, offers: [], evidence: [], rejectedCounts: emptyRejected(), entries: [], notSearched };
}

/** Ranks per candidate; an offer URL already shown for an earlier candidate is not shown again. */
function validate(
  classified: Classified[],
  market: Market,
  { citationUrls, registerImages }: { citationUrls: string[]; registerImages: (sources: ImageSource[]) => ImageCandidate[] },
): ProductResult[] {
  const shown = new Set<string>();
  return classified.map((c) => {
    const fresh = c.offers.filter((offer) => !shown.has(offer.canonicalUrl));
    for (const offer of fresh) shown.add(offer.canonicalUrl);
    const { name, brand, modelIdentifiers, keySpecs, reason } = c.candidate;
    return {
      // Without the raw keySpecs and reason: the card reads only the normalized fields below.
      candidate: { name, brand, modelIdentifiers },
      keySpecs: normalizeKeySpecs(keySpecs),
      reason: resolveReason(reason, citationUrls),
      imageCandidates: registerImages(rankImageCandidates(c.entries, c.candidate, market)),
      offerGroups: rankOffers(fresh, market),
      evidence: c.evidence,
      rejectedCounts: c.rejectedCounts,
      ...(c.notSearched !== undefined && { notSearched: c.notSearched }),
    };
  });
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
    registerImages = () => [],
  } = options;
  const { question, market } = input;
  const budget = new RequestBudget(MAX_EXA_REQUESTS_PER_RUN);
  const runSignal = AbortSignal.any([signal, AbortSignal.timeout(runTimeoutMs)]);
  const usage: RunUsage = { exaRequests: 0, cacheHits: 0, costDollars: 0 };
  let retriesLeft = 1;
  const runStart = clock();

  log({ event: "run_start", runId, market, question });

  /** The stage's `running` event now, and its closing event (with the log line) when it ends. */
  function startStage(stage: Stage) {
    const started = clock();
    return {
      running: { type: "progress", stage, status: "running" } satisfies RunEvent,
      finish(status: "done" | "failed", detail?: string): RunEvent {
        log({ event: "stage", runId, stage, status, requestCount: budget.used, durationMs: clock() - started });
        return { type: "progress", stage, status, ...(detail !== undefined && { detail }) };
      },
    };
  }

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

  const canRetry = (failure: ExaFailure): boolean =>
    failure.retryable && retriesLeft > 0 && budget.used < MAX_EXA_REQUESTS_PER_RUN && !runSignal.aborted;

  const backoffMs = (failure: ExaFailure): number =>
    failure.kind === "rate_limited" ? Math.min(failure.retryAfterMs ?? RATE_LIMIT_FALLBACK_MS, RETRY_AFTER_CAP_MS) : RETRY_BACKOFF_MS;

  const fail = (failure: RunFailure, partial: boolean): RunEvent[] => {
    log({ event: "run_end", runId, state: "failed", errorKind: failure.kind, requestCount: budget.used, durationMs: clock() - runStart });
    return [
      { type: "usage", usage },
      { type: "error", kind: failure.kind, message: failure.message, partial },
      { type: "end", state: "failed" },
    ];
  };

  try {
    // Stage 1: candidates (1 request)
    const candidatesStage = startStage("candidates");
    yield candidatesStage.running;
    let answer;
    try {
      answer = await exaCall("candidates", "answer", (s) => port.answerCandidates(question, market, budget, s));
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      const failure = mapExaError(error);
      // The first request of a run cannot hit the per-question budget.
      if (!isRunFailure(failure)) throw failure;
      yield candidatesStage.finish("failed");
      yield* fail(failure, false);
      return;
    }
    yield candidatesStage.finish("done", `${answer.candidates.length} candidate(s)`);

    // D-042: cut leaked structure before resolving, so markers inside the cut part never reach the sources.
    const cut = cutLeakedStructure(answer.comparison);
    const cited = cut && resolveCitations(cut.text, answer.citationUrls);
    const comparison: RunEvent = {
      type: "comparison",
      text: cited?.renderedText ?? null,
      truncated: cut?.truncated ?? true,
      sources: (cited?.citedSources ?? []).map((s) => ({ url: s.url, sourceId: s.numbers.join(",") })),
    };
    const validation = { citationUrls: answer.citationUrls, registerImages };

    // Stage 2: offers (1 request per candidate: 1 and 2, then 3 only if 1 and 2 found no merchant offer)
    const offersStage = startStage("offers");
    yield offersStage.running;

    const search = async (candidate: Candidate): Promise<Searched> => {
      let hits: SearchHit[];
      try {
        hits = (await exaCall("offers", "search", (s) => port.searchOffers(candidate, market, budget, s))).hits;
      } catch (error) {
        if (error instanceof Cancelled) throw error;
        const failure = mapExaError(error);
        if (!isRunFailure(failure)) return { status: "not-searched", candidate, reason: NOT_SEARCHED_BUDGET };
        return { status: "failed", candidate, failure };
      }
      // Outside the try: a classification bug is a bug, not an Exa failure.
      return { status: "searched", classified: classifyAll(candidate, hits) };
    };
    const notSearched = (candidate: Candidate, reason: string): Searched => ({ status: "not-searched", candidate, reason });

    const [first, second, third] = answer.candidates.slice(0, 3);
    const results = await Promise.all([first, second].flatMap((c) => (c ? [search(c)] : [])));
    if (third) {
      const failed = results.some((r) => r.status === "failed");
      const hasOffers = results.some((r) => r.status === "searched" && r.classified.offers.length > 0);
      results.push(failed ? notSearched(third, NOT_SEARCHED_FAILED) : hasOffers ? notSearched(third, NOT_SEARCHED_OFFERS) : await search(third));
    }
    if (signal.aborted) throw new Cancelled();
    const classified = results.map(classifiedOf);

    const failure = results.find((r): r is Extract<Searched, { status: "failed" }> => r.status === "failed")?.failure;
    if (failure) {
      yield offersStage.finish("failed");
      yield comparison;
      yield { type: "products", products: validate(classified, market, validation) };
      yield* fail(failure, true);
      return;
    }
    yield offersStage.finish("done", `${results.filter((r) => r.status === "searched").length} candidate(s) searched`);

    // Stage 3: validate (no request)
    const validateStage = startStage("validate");
    yield validateStage.running;
    yield { type: "products", products: validate(classified, market, validation) };
    yield validateStage.finish("done");

    // Stage 4: compare (no request)
    const compareStage = startStage("compare");
    yield compareStage.running;
    yield comparison;
    yield compareStage.finish("done");

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
