import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Candidate, Market } from "../core/types";
import type { RequestBudget } from "./budget";
import { StoredAnswerSchema, StoredSearchSchema } from "./cache";
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import { ExaFailure } from "./errors";
import { guarded } from "./guard";
import type { GuardDeps } from "./guard";
import { CandidateSchema, parseAnswerResponse, parseSearchResponse } from "./parse";
import type { AnswerResult, ExaPort, SearchResult } from "./port";
import { buildAnswerRequest, buildSearchRequest, cacheKey } from "./requests";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FROZEN_DIR = "evals/fixtures";

const ResponseSchema = z.object({
  /** Path, relative to the repository root, of a frozen file under evals/fixtures/. Its `response` is replayed. */
  ref: z.string(),
  /** Synthetic part: replaces an /answer string with `{ comparison: <ref's answer>, candidates }`. */
  candidates: z.array(CandidateSchema).optional(),
});

const ErrorSchema = z.object({
  kind: z.enum(["auth", "credits_exhausted", "monthly_limit", "rate_limited", "upstream", "timeout", "budget_exhausted"]),
  retryAfterMs: z.number().optional(),
  message: z.string().optional(),
});

const StepSchema = z
  .object({
    op: z.enum(["answer", "search"]),
    /** Required, and must start with "SYNTHETIC", whenever the step holds synthetic content. */
    label: z.string().optional(),
    delayMs: z.number().int().nonnegative().optional(),
    response: ResponseSchema.optional(),
    error: ErrorSchema.optional(),
  })
  .refine((s) => (s.response === undefined) !== (s.error === undefined), "a step needs exactly one of response or error")
  .refine(
    (s) => (s.response?.candidates === undefined && s.error === undefined) || s.label?.startsWith("SYNTHETIC") === true,
    "synthetic steps need a label starting with SYNTHETIC",
  );

export const ScenarioSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string(),
  steps: z.array(StepSchema),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
type Step = Scenario["steps"][number];

export interface FixtureOptions extends GuardDeps {
  clock?: Clock;
  /** Directory holding `<name>.json` scenarios. Default: tests/fixtures/scenarios in this repository. */
  scenariosDir?: string;
  rootDir?: string;
}

export function loadScenario(name: string, options: Pick<FixtureOptions, "scenariosDir" | "rootDir"> = {}): Scenario {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid fixture scenario name: ${name}`);
  const dir = options.scenariosDir ?? join(options.rootDir ?? REPO_ROOT, "tests/fixtures/scenarios");
  const scenario = ScenarioSchema.parse(JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")));
  if (scenario.name !== name) throw new Error(`Scenario file ${name}.json declares name ${scenario.name}`);
  return scenario;
}

function loadFrozen(ref: string, rootDir: string): Record<string, unknown> {
  const frozen = resolve(rootDir, FROZEN_DIR);
  const path = resolve(rootDir, ref);
  if (!path.startsWith(frozen + sep)) throw new Error(`Scenario ref ${ref} is outside ${FROZEN_DIR}/`);
  const file = JSON.parse(readFileSync(path, "utf8")) as { response?: Record<string, unknown> };
  if (!file.response) throw new Error(`Frozen file ${ref} has no response`);
  return file.response;
}

function wire(step: Step, rootDir: string): unknown {
  const response = step.response!;
  const body = loadFrozen(response.ref, rootDir);
  if (step.op === "answer" && response.candidates) {
    if (typeof body.answer !== "string") throw new Error(`${response.ref}: expected a string answer to compose with`);
    return { ...body, answer: { comparison: body.answer, candidates: response.candidates } };
  }
  return body;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolveSleep();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Replays a named scenario, one step per live call in order. It never matches requests. Every
 * replayed call goes through the same guard as the live port, so it takes a budget token, and a
 * cache or ledger passed in behaves exactly as it does live. `calls` counts replayed calls.
 */
export class FixtureExaPort implements ExaPort {
  readonly scenario: Scenario;
  readonly #deps: GuardDeps;
  readonly #clock: Clock;
  readonly #rootDir: string;
  #next = 0;

  constructor(scenario: Scenario, options: FixtureOptions = {}) {
    this.scenario = scenario;
    this.#deps = { cache: options.cache, ledger: options.ledger };
    this.#clock = options.clock ?? systemClock;
    this.#rootDir = options.rootDir ?? REPO_ROOT;
  }

  static load(name: string, options: FixtureOptions = {}): FixtureExaPort {
    return new FixtureExaPort(loadScenario(name, options), options);
  }

  get calls(): number {
    return this.#next;
  }

  answerCandidates(question: string, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<AnswerResult> {
    return guarded(this.#deps, {
      key: cacheKey("/answer", buildAnswerRequest(question, market, "userLocation"), market),
      schema: StoredAnswerSchema,
      budget,
      signal,
      call: async () => ({
        ...parseAnswerResponse(await this.#replay("answer", signal)),
        retrievedAt: this.#clock().toISOString(),
      }),
    });
  }

  searchOffers(candidate: Candidate, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<SearchResult> {
    return guarded(this.#deps, {
      key: cacheKey("/search", buildSearchRequest(candidate, market), market),
      schema: StoredSearchSchema,
      budget,
      signal,
      call: async () => {
        const parsed = parseSearchResponse(await this.#replay("search", signal));
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

  async #replay(op: Step["op"], signal: AbortSignal): Promise<unknown> {
    const step = this.scenario.steps[this.#next];
    this.#next += 1;
    if (!step) throw new ExaFailure("upstream", `Fixture scenario ${this.scenario.name} has no step ${this.#next}.`);
    if (step.op !== op) {
      throw new ExaFailure("upstream", `Fixture scenario ${this.scenario.name} step ${this.#next} is ${step.op}, called ${op}.`);
    }
    if (step.delayMs) await sleep(step.delayMs, signal);
    if (step.error) {
      throw new ExaFailure(step.error.kind, step.error.message ?? `Scripted ${step.error.kind} failure.`, {
        ...(step.error.retryAfterMs !== undefined && { retryAfterMs: step.error.retryAfterMs }),
      });
    }
    return wire(step, this.#rootDir);
  }
}
