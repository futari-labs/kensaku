# FutariLabs progress

Phase: execution of approved plan `kensaku-mvp-v1` (approval commit `3fe529f`, snapshot `77dafb5d205516cc5843651290b6881c79449a97c82e7a82470bc2afb39fbecc` at `eed64a9`).

## Execution session 2026-11-21

- Started with `/futari:execute` (futari 1.0.2). `node .futari/plan-gate.mjs verify`: PASS. Remote `futari-labs/kensaku`, private, default branch `dev` containing the approval commit.
- pstack `pstack@pstack-claude` 0.9.145 (git `ce7df681`), matching the plan. `check-playbooks.mjs`: "Every project playbook matches this pstack's playbooks." Invoked `pstack:poteto-mode` via the Skill tool; loaded `.agents/playbooks/futari-approved-plan.md` (standalone).
- Models per `.claude/pstack-models.md`: implementation workers `sonnet` (`pstack:poteto-agent`); independent reviews `opus` (`thermos` pair, then delta re-review).
- Issues #1-#6 created for JM-001..JM-006 with exact `Futari-Plan`/`Futari-Task` markers.
- Observation (no change requested): `.futari/ci-check.mjs` parses `Verdict:` with `[A-Z_]+`, so `Verdict: NOT VERIFIED` fails with "Invalid Verdict marker" rather than "must be VERIFIED". Same outcome (check fails until VERIFIED); harmless.

## Current design position

Updated 2026-11-21.

- Plan `kensaku-mvp-v1`, decisions D-001 to D-025, requirements REQ-001 to REQ-010, evaluations EV-001 to EV-009, tasks JM-001 to JM-006. `node .futari/plan-gate.mjs check` passes; `node evals/harness.mjs` reports HARNESS OK with every evaluation NOT RUNNABLE (no product code yet).
- Exa spike: 12 of 20 approved requests used, $0.118 of free credits, all HTTP 200, key absent from fixtures. Findings in `docs/futari/research/exa-2026-11-21.md`.
- Independent review of `551288c`: CHANGES REQUIRED; all 15 findings resolved (see `REVIEW.md`). Re-review of the corrected revision recorded in `REVIEW.md`.
- Working copy: worktree `.claude/worktrees/bootstrap-resume`, branch `bootstrap-resume` (rooted on an empty commit because `init` had no commits). The main checkout still holds older untracked copies of the planning files plus the owner's `.env.local`.
- Approved by the owner for after plan approval (D-024 narrowed by D-025): create `dev` from `bootstrap-resume`; push it and make it the default branch; move the main checkout's replaced untracked files to `~/kensaku-untracked-backup-2026-11-21/` and check out `dev` there. The owner creates `main` personally; no agent pushes, merges, or auto-merges into `main`.
- First approval card (commit `6a1c031`): owner chose "Request changes" and asked for a third review, a visibility check, and a protection check. Visibility verified as private on GitHub Free (`research/github-2026-11-21.md`); GitHub enforces no branch protection; gaps recorded as R-13 and R-14.
- Third independent review: CHANGES REQUIRED (narrow) at `89f7901`, fixed in `2b9140b`, final verdict READY at `2b9140b` (see `REVIEW.md`).
- Next step: fresh approval card. Nothing executes before an `Approve plan` selection.

## Execution ledger

Filled in after approval; reconcile every entry with actual GitHub and Git state.

| Task | Issue | Branch/worktree | PR | Tested revision | Status | Evidence / next action |
| --- | --- | --- | --- | --- | --- | --- |
| JM-001 | [#1](https://github.com/futari-labs/kensaku/issues/1) | `jm-001-scaffold` | [#7](https://github.com/futari-labs/kensaku/pull/7) | `d8fe2fb` | merged (`4b3aeae`), dev push CI green (run 44794744362) | `.futari/evidence/JM-001.md` |
| JM-002 | [#2](https://github.com/futari-labs/kensaku/issues/2) | `jm-002-core-rules` | [#8](https://github.com/futari-labs/kensaku/pull/8) | `73c0c8f` | verified, merging | `.futari/evidence/JM-002.md`; thermos APPROVE at 9f5a0f8; repair round 1; delta APPROVE at 73c0c8f |
| JM-003 | [#3](https://github.com/futari-labs/kensaku/issues/3) | - | - | - | pending (needs JM-001 merged) | - |
| JM-004 | [#4](https://github.com/futari-labs/kensaku/issues/4) | - | - | - | pending | brief must include: app factory split of `src/server/index.ts`, typed env config enforcing fixture-only-under-NODE_ENV=test, Host/Origin guard; Exa summaries parsed with zod at the boundary (core trusts types); `resolveCitations` should call `splitParagraphs` |
| JM-005 | [#5](https://github.com/futari-labs/kensaku/issues/5) | - | - | - | pending | brief must include: AI Elements CLI writes to `src/components/ai-elements/` (move unchanged), `"use client"` drift on reinstall, run `check-components --update` in the same commit |
| JM-006 | [#6](https://github.com/futari-labs/kensaku/issues/6) | - | - | - | pending | - |

## Milestone verification

Record actual slice and integration verdicts and remaining blockers. Never infer completion from agent activity.
