import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../../src/exa/files";

export const EXA_COUNTER_PATH = resolve(".cache/live/v1-2-exa-counter.json");
export const SMOKE_EXA_CAP = 5;
export const PLAN_EXA_CAP = 30;
export const PLAN_COST_CAP_DOLLARS = 0.4;
export const EV023_EXA_CAP = 25;
export const RUN_EXA_MAX = 5;
export const WORST_CASE_ATTEMPT_COST_DOLLARS = 0.06;
export const JM203_SMOKE_COST_ESTIMATE_DOLLARS = 0.05;

export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

const Count = z.number().int().nonnegative();
const Dollars = z.number().nonnegative();
const CounterSchema = z.object({ planRequests: Count, smokeRequests: Count, ev023Requests: Count.default(0), planCostDollars: Dollars.default(0) });
export type ExaCounter = z.infer<typeof CounterSchema>;

export interface PlanUsage {
  planRequests: number;
  planCostDollars: number;
  ev023Requests: number;
}

export function readExaCounter(path: string): ExaCounter {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return CounterSchema.parse({ planRequests: 0, smokeRequests: 0 });
    throw error;
  }
  return CounterSchema.parse(JSON.parse(text));
}

export function exaBudgetRefusal(counter: Pick<ExaCounter, "planRequests" | "smokeRequests">): string | undefined {
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

export function addAcceptanceExaSpend(path: string, spend: { requests: number; costDollars: number }): ExaCounter {
  const before = readExaCounter(path);
  const after = {
    ...before,
    planRequests: before.planRequests + spend.requests,
    ev023Requests: before.ev023Requests + spend.requests,
    planCostDollars: round6(before.planCostDollars + spend.costDollars),
  };
  writeJsonAtomic(path, after);
  return after;
}

const SMOKE_LOG = /^jm-203-sandbox-smoke-.*\.json$/;
const RUN_LOG = /^ev-023-run-\d+-\d{8}T\d{6}Z\.json$/;
const SmokeLogSchema = z.object({ exa: z.object({ requests: Count }) });
const RunLogSpendSchema = z.object({ exa: z.object({ ev023Requests: Count, ev023CostDollars: Dollars }).partial().optional() });

export function usageFromEvidence(dir: string): PlanUsage {
  const usage: PlanUsage = { planRequests: 0, planCostDollars: 0, ev023Requests: 0 };
  if (!existsSync(dir)) return usage;
  for (const file of readdirSync(dir).sort()) {
    const read = () => JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    if (SMOKE_LOG.test(file)) {
      usage.planRequests += SmokeLogSchema.parse(read()).exa.requests;
      usage.planCostDollars += JM203_SMOKE_COST_ESTIMATE_DOLLARS;
    } else if (RUN_LOG.test(file)) {
      const spent = RunLogSpendSchema.parse(read()).exa;
      usage.planRequests += spent?.ev023Requests ?? 0;
      usage.ev023Requests += spent?.ev023Requests ?? 0;
      usage.planCostDollars += spent?.ev023CostDollars ?? 0;
    }
  }
  return { ...usage, planCostDollars: round6(usage.planCostDollars) };
}

export function planUsage(counter: ExaCounter, evidence: PlanUsage): PlanUsage {
  return {
    planRequests: Math.max(counter.planRequests, evidence.planRequests),
    planCostDollars: round6(Math.max(counter.planCostDollars, evidence.planCostDollars)),
    ev023Requests: Math.max(counter.ev023Requests, evidence.ev023Requests),
  };
}

export function acceptanceBudgetRefusal(usage: PlanUsage): string | undefined {
  if (usage.ev023Requests + RUN_EXA_MAX > EV023_EXA_CAP) return `EV-023 has already spent ${usage.ev023Requests} of its ${EV023_EXA_CAP} Exa requests.`;
  if (usage.planRequests + RUN_EXA_MAX > PLAN_EXA_CAP) return `the plan has already spent ${usage.planRequests} of its ${PLAN_EXA_CAP} live Exa requests.`;
  if (usage.planCostDollars + WORST_CASE_ATTEMPT_COST_DOLLARS > PLAN_COST_CAP_DOLLARS) return `the plan has already spent $${usage.planCostDollars} of its $${PLAN_COST_CAP_DOLLARS} live Exa budget.`;
  return undefined;
}
