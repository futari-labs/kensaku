// EV-016 budget accounting (evals/cases/live-acceptance-v1-1.json, "budget"). Pure: it reads committed logs it is given
// and decides whether the next query may start. The plan-wide cap governs over the per-run caps.

export interface Budget {
  maxRequestsPerQuery: number;
  maxRequestsPerSuiteRun: number;
  maxSuiteRuns: number;
  maxReportedCostDollarsPerSuiteRun: number;
  planTotal: string;
}

export interface Usage {
  requests: number;
  costDollars: number;
}

export interface PlanCaps {
  requests: number;
  costDollars: number;
  /** The plan-wide remaining cost below which no query starts. */
  minCostDollars: number;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const none: Usage = { requests: 0, costDollars: 0 };

/** The plan-wide caps, read from the frozen prose of `budget.planTotal` so they cannot drift from it. */
export function planCapsOf({ planTotal }: Pick<Budget, "planTotal">): PlanCaps {
  const total = /at most (\d+) Exa requests and \$(\d+(?:\.\d+)?)/.exec(planTotal);
  const floor = /below \$(\d+(?:\.\d+)?)/.exec(planTotal);
  if (!total || !floor) throw new Error("budget.planTotal no longer states the plan-wide caps in the expected words");
  return { requests: Number(total[1]), costDollars: Number(total[2]), minCostDollars: Number(floor[1]) };
}

interface Exchange {
  costDollars?: number | null;
}

export function usageOfExchanges(exchanges: readonly Exchange[]): Usage {
  return { requests: exchanges.length, costDollars: round(exchanges.reduce((n, e) => n + (e.costDollars ?? 0), 0)) };
}

export const addUsage = (a: Usage, b: Usage): Usage => ({ requests: a.requests + b.requests, costDollars: round(a.costDollars + b.costDollars) });

/**
 * What the committed logs have already used against the plan: the JM-104 smoke logs (one query each) and every EV-016 run
 * log (many queries). The MVP logs (jm-004, ev-008) were spent under the MVP plan and do not count.
 */
export function committedUsage(logs: readonly { name: string; json: unknown }[]): Usage {
  let used = none;
  for (const { name, json } of logs) {
    const log = json as { exaExchanges?: Exchange[]; queries?: { exaExchanges?: Exchange[] }[] };
    if (/^jm-104-smoke-.*\.json$/.test(name)) used = addUsage(used, usageOfExchanges(log.exaExchanges ?? []));
    else if (/^ev-016-run-\d+-.*\.json$/.test(name)) for (const q of log.queries ?? []) used = addUsage(used, usageOfExchanges(q.exaExchanges ?? []));
  }
  return used;
}

export type Decision = { start: true } | { start: false; reason: string };

/** Whether the next query's worst case (the per-query cap) still fits every limit. `prior` is the committed usage, `run` this run's so far. */
export function mayStartQuery(budget: Budget, prior: Usage, run: Usage): Decision {
  const plan = planCapsOf(budget);
  const planRequestsLeft = plan.requests - prior.requests - run.requests;
  const planCostLeft = round(plan.costDollars - prior.costDollars - run.costDollars);
  const runCostLeft = round(budget.maxReportedCostDollarsPerSuiteRun - run.costDollars);
  if (planRequestsLeft < budget.maxRequestsPerQuery) return { start: false, reason: `plan-wide: ${planRequestsLeft} requests left, the worst case is ${budget.maxRequestsPerQuery}` };
  if (planCostLeft < plan.minCostDollars) return { start: false, reason: `plan-wide: $${planCostLeft} left, under the $${plan.minCostDollars} floor` };
  if (run.requests + budget.maxRequestsPerQuery > budget.maxRequestsPerSuiteRun) return { start: false, reason: `run: ${run.requests} requests used, the worst case would pass ${budget.maxRequestsPerSuiteRun}` };
  if (runCostLeft < plan.minCostDollars) return { start: false, reason: `run: $${runCostLeft} left of $${budget.maxReportedCostDollarsPerSuiteRun}, under the $${plan.minCostDollars} floor` };
  return { start: true };
}

/** The limits the server's own ledger enforces for this run: what is left of the plan, capped by the run limits. */
export function serverLimits(budget: Budget, prior: Usage): { requests: number; costDollars: number } {
  const plan = planCapsOf(budget);
  return {
    requests: Math.max(0, Math.min(budget.maxRequestsPerSuiteRun, plan.requests - prior.requests)),
    costDollars: Math.max(0, round(Math.min(budget.maxReportedCostDollarsPerSuiteRun, plan.costDollars - prior.costDollars))),
  };
}
