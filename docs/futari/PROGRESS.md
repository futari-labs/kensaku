# FutariLabs progress

Phase: interactive bootstrap. No implementation is approved.

## Current design position

Updated 2026-11-21.

- Plan `kensaku-mvp-v1`, decisions D-001 to D-025, requirements REQ-001 to REQ-010, evaluations EV-001 to EV-009, tasks JM-001 to JM-006. `node .futari/plan-gate.mjs check` passes; `node evals/harness.mjs` reports HARNESS OK with every evaluation NOT RUNNABLE (no product code yet).
- Exa spike: 12 of 20 approved requests used, $0.118 of free credits, all HTTP 200, key absent from fixtures. Findings in `docs/futari/research/exa-2026-11-21.md`.
- Independent review of `551288c`: CHANGES REQUIRED; all 15 findings resolved (see `REVIEW.md`). Re-review of the corrected revision recorded in `REVIEW.md`.
- Working copy: worktree `.claude/worktrees/bootstrap-resume`, branch `bootstrap-resume` (rooted on an empty commit because `init` had no commits). The main checkout still holds older untracked copies of the planning files plus the owner's `.env.local`.
- Approved by the owner for after plan approval (D-024 narrowed by D-025): create `dev` from `bootstrap-resume`; push it and make it the default branch; move the main checkout's replaced untracked files to `~/kensaku-untracked-backup-2026-11-21/` and check out `dev` there. The owner creates `main` personally; no agent pushes, merges, or auto-merges into `main`.
- First approval card (commit `6a1c031`): owner chose "Request changes" and asked for a third review, a visibility check, and a protection check. Visibility verified as private on GitHub Free (`research/github-2026-11-21.md`); GitHub enforces no branch protection; gaps recorded as R-13 and R-14.
- Next step: third independent review of the final contract, then a fresh approval card. Nothing executes before an `Approve plan` selection.

## Execution ledger

Filled in after approval; reconcile every entry with actual GitHub and Git state.

| Task | Issue | Branch/worktree | PR | Tested revision | Status | Evidence / next action |
| --- | --- | --- | --- | --- | --- | --- |

## Milestone verification

Record actual slice and integration verdicts and remaining blockers. Never infer completion from agent activity.
