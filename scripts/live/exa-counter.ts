import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../../src/exa/files";

/** Exa requests across the whole kensaku-v1-2 plan. The JM-203 smoke and EV-023 (`pnpm live:acceptance:v1-2`) both add to it. */
export const EXA_COUNTER_PATH = resolve(".cache/live/v1-2-exa-counter.json");
export const SMOKE_EXA_CAP = 5;
export const PLAN_EXA_CAP = 30;
export const EV023_EXA_CAP = 25;
/** What one Q1 research run may spend: the per-query cap of the live plan. */
export const RUN_EXA_MAX = 5;

const Count = z.number().int().nonnegative();
/** `ev023Requests` is absent from counters the JM-203 smoke wrote. */
const CounterSchema = z.object({ planRequests: Count, smokeRequests: Count, ev023Requests: Count.optional() });
export type ExaCounter = z.infer<typeof CounterSchema>;

export function readExaCounter(path: string): ExaCounter {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { planRequests: 0, smokeRequests: 0 };
    throw error;
  }
  return CounterSchema.parse(JSON.parse(text));
}

/** The reason a research run may not start, or undefined when its worst case fits both caps. */
export function exaBudgetRefusal(counter: ExaCounter): string | undefined {
  if (counter.smokeRequests + RUN_EXA_MAX > SMOKE_EXA_CAP) return `the smoke has already spent ${counter.smokeRequests} of its ${SMOKE_EXA_CAP} Exa requests; reuse offers with --offer-id.`;
  if (counter.planRequests + RUN_EXA_MAX > PLAN_EXA_CAP) return `the plan has already spent ${counter.planRequests} of its ${PLAN_EXA_CAP} live Exa requests.`;
  return undefined;
}

export function addSmokeExaRequests(path: string, requests: number): ExaCounter {
  const before = readExaCounter(path);
  const after = { ...before, planRequests: before.planRequests + requests, smokeRequests: before.smokeRequests + requests };
  writeJsonAtomic(path, after);
  return after;
}

export const ev023Spent = (counter: ExaCounter): number => counter.ev023Requests ?? 0;

/** The reason a research run may not start in EV-023, or undefined when its worst case fits the EV-023 and plan-wide caps. */
export function acceptanceBudgetRefusal(counter: ExaCounter): string | undefined {
  const spent = ev023Spent(counter);
  if (spent + RUN_EXA_MAX > EV023_EXA_CAP) return `EV-023 has already spent ${spent} of its ${EV023_EXA_CAP} Exa requests.`;
  if (counter.planRequests + RUN_EXA_MAX > PLAN_EXA_CAP) return `the plan has already spent ${counter.planRequests} of its ${PLAN_EXA_CAP} live Exa requests.`;
  return undefined;
}

export function addAcceptanceExaRequests(path: string, requests: number): ExaCounter {
  const before = readExaCounter(path);
  const after = { ...before, planRequests: before.planRequests + requests, ev023Requests: ev023Spent(before) + requests };
  writeJsonAtomic(path, after);
  return after;
}
