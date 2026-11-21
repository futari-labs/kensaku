import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { EXA_FAILURE_KINDS, ExaFailure } from "./errors";
import type { ExaFailureKind } from "./errors";
import { GuardedExaPort } from "./guarded-port";
import type { ExaTransport, PortOptions } from "./guarded-port";
import { CandidateSchema } from "./schemas";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FROZEN_DIR = "evals/fixtures";
/** A scripted failure has no HTTP status, so it is retryable exactly when the live mapping would retry a status-less failure of that kind. */
const TRANSIENT_KINDS: ReadonlySet<ExaFailureKind> = new Set(["rate_limited", "timeout", "upstream"]);

const ResponseSchema = z.object({
  /** Path, relative to the repository root, of a frozen file under evals/fixtures/. Its `response` is replayed. */
  ref: z.string(),
  /** Synthetic part: replaces an /answer string with `{ comparison: <ref's answer>, candidates }`. */
  candidates: z.array(CandidateSchema).optional(),
});

const ErrorSchema = z.object({
  kind: z.enum(EXA_FAILURE_KINDS),
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

export interface FixtureOptions extends PortOptions {
  /** Repository root holding `tests/fixtures/scenarios/` and `evals/fixtures/`. Default: this repository. */
  rootDir?: string;
}

export function loadScenario(name: string, options: Pick<FixtureOptions, "rootDir"> = {}): Scenario {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid fixture scenario name: ${name}`);
  const dir = join(options.rootDir ?? REPO_ROOT, "tests/fixtures/scenarios");
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

/** The fixture transport: step N of the scenario answers call N, in order, with no request matching. */
class ScenarioReplayer implements ExaTransport {
  #next = 0;

  constructor(
    readonly scenario: Scenario,
    readonly rootDir: string,
  ) {}

  get calls(): number {
    return this.#next;
  }

  answer(_request: unknown, signal: AbortSignal): Promise<unknown> {
    return this.#replay("answer", signal);
  }

  search(_request: unknown, signal: AbortSignal): Promise<unknown> {
    return this.#replay("search", signal);
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
        retryable: TRANSIENT_KINDS.has(step.error.kind),
      });
    }
    return wire(step, this.rootDir);
  }
}

/**
 * Replays a named scenario through the same guard as the live port (see tests/fixtures/scenarios/README.md),
 * so every replayed call takes a budget token, and a cache or ledger passed in behaves exactly as it
 * does live. `calls` counts replayed calls. The ledger is optional here, unlike the live port.
 */
export class FixtureExaPort extends GuardedExaPort {
  readonly scenario: Scenario;
  readonly #replayer: ScenarioReplayer;

  constructor(scenario: Scenario, options: FixtureOptions = {}) {
    const { rootDir = REPO_ROOT, ...portOptions } = options;
    const replayer = new ScenarioReplayer(scenario, rootDir);
    super(replayer, portOptions);
    this.scenario = scenario;
    this.#replayer = replayer;
  }

  static load(name: string, options: FixtureOptions = {}): FixtureExaPort {
    return new FixtureExaPort(loadScenario(name, options), options);
  }

  get calls(): number {
    return this.#replayer.calls;
  }
}
