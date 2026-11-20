# FutariLabs progress

Phase: interactive bootstrap. No implementation is approved.

## Current design position

Updated 2026-11-21 (resume session).

- Working copy: worktree `.claude/worktrees/bootstrap-resume`, branch `bootstrap-resume`, based on an empty root commit, because branch `init` has no commits. The main checkout's untracked files are the pre-resume copies; this branch holds the current planning state.
- Last settled decisions: D-011 (search plus per-result summary extraction for offers), D-012 (free plan, no card, plus a per-run request cap), D-013 (spike mechanics).
- Spike done: 8/20 requests, $0.084 free credits, all HTTP 200. Results and limitations L1-L8 are in `docs/futari/research/exa-2026-11-21.md`. Fixtures are in `evals/fixtures/exa-live/`.
- Drafted: `PRODUCT_SPEC.md` (REQ-001..REQ-008, assumptions A-1..A-3). Not yet drafted: ARCHITECTURE, EVALUATION_PLAN, EXECUTION_PLAN, RISKS, plan.json.
- Open questions for the owner: A-1 region and currency (USD only?), A-2 chat history persistence, how to handle Best Buy and Target pages with no extractable price (L4), and the per-run request cap N.
- Next step: answer the open questions, then draft architecture, the offer-validation evaluation (fixture-based, using the L1/L2/L3 cases), and the plan; then independent review.

## Execution ledger

Populate after approval; reconcile every entry with actual GitHub and Git state.

| Task | Issue | Branch/worktree | PR | Tested revision | Status | Evidence / next action |
| --- | --- | --- | --- | --- | --- | --- |

## Milestone verification

Record actual slice/integration verdicts and remaining blockers. Never infer completion from agent activity.
