# FutariLabs progress

Phase: **v1.2 execution** — plan `kensaku-v1-2` revision CR-005 on `dev`; vertical slice merged (JM-201..JM-203); JM-204 merge-ready; JM-205 next. v1.1 (plan `kensaku-v1-1`) is complete and accepted (2026-11-22) and archived in `docs/futari/archive/kensaku-v1-1/`; the MVP is archived in `docs/futari/archive/kensaku-mvp-v1/`.

(Previous phase line, kept for history: **v1.1 complete and accepted by the owner** (plan `kensaku-v1-1`, revision CR-003; final `dev` head `878c7cf`). The MVP plan `kensaku-mvp-v1` is complete: PR #13 was merged into `dev` (`a3a2894`) and the owner accepted the MVP. Its contract is archived in `docs/futari/archive/kensaku-mvp-v1/` (approval at plan commit `2866477`, snapshot `c4bce63625eab7d095e1a70737497c524de12cace00bfde4ffd978fbe96cdb36`).)

## v1.2 planning session 2026-11-23

- Started with `/futari:bootstrap` (no brief). Existing approval `kensaku-v1-1` verified (`plan-gate verify` PASS at `47f813d`); no new approval was created for it. The owner gave the v1.2 brief "Stripe Sandbox Commerce" on the native card.
- Branch `v1-2-plan` from `dev` `fdb446a`, in the main checkout.
- Research: `research/stripe-2026-11-23.md` (S1-S63) from official Stripe docs, the `stripe@23.1.0` package, and the Stripe CLI and stripe-mock sources. No Stripe API call and no key were used (owner brief).
- Owner decisions on AskUserQuestion cards: copy observed price as demo price (D-045); one-currency cart (D-046); verified webhook only (D-047); agent API checks plus owner hosted-page steps (D-049); server-registered offers only (D-048); v1.1 limits plus ≤ 30 Exa requests / $0.40 (D-051).
- Frozen v1.2 inputs (synthetic, assistant-proposed labels): `evals/cases/commerce-rules.json` (4 id, 11 minor-unit, 28 cart, 2 snapshot cases), `checkout-session-request.json` (3), `webhook-events.json` (24 webhook, 11 route cases), `live-acceptance-v1-2.json` (3 queries, 8 scenarios, audit H1-H5). `node evals/harness.mjs`: HARNESS OK; EV-018 to EV-023 NOT RUNNABLE until implemented; a three-point mutation check made the harness fail each time.
- v1.1 contract archived byte-for-byte; the live `.futari/approval.json` is removed in the reviewed commit (D-044).
- Open owner prerequisites before JM-203's sandbox smoke: Stripe sandbox, CLI login, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (EXECUTION_PLAN "Owner prerequisites"). The Stripe CLI is not installed on this machine yet.
- Independent review of `2d268dc` (fable, read-only): CHANGES REQUIRED, 12 findings (1 blocking), every frozen label reproduced. All resolved in `c5967cd` (D-058). Re-review of `c5967cd`: CHANGES REQUIRED, text only (N1-N6), every label reproduced again; N1-N6 resolved in the reviewed commit. Details in REVIEW.md.
- `node .futari/plan-gate.mjs check`: PASS; `node evals/harness.mjs`: HARNESS OK (34 cart, 11 minor-unit, 4 session-request, 30 webhook, 19 route cases, 8 live scenarios); `--strict --final` fails by design until EV-018 to EV-023 exist; pstack `check-playbooks.mjs`: compatible.
- Approval: the owner (d3F0g) selected "Approve plan" on the native card for `kensaku-v1-2` at `f1abbc72a3a981f05fc2b1ba11e193fc88d86cf5`; the card stated that approving replaces the `kensaku-v1-1` baseline. Recorded in `ab45038` (`.futari/approval.json` only); `plan-gate verify`: PASS, snapshot `164b7bf02bd57c3a27d7cc34ed754d85f91e4e73ea69b0275f05e2133fe91fdc`.
- Publication: with the owner's authorization, `v1-2-plan` was pushed and PR #30 opened into `dev`. `CI` passed. `Futari contract` fails by design at the `Futari-Plan` marker check, as PR #15 did (R-38).
- Next step: the owner merges PR #30 personally with a merge commit. Then complete the Stripe owner prerequisites (EXECUTION_PLAN) before JM-203, and run `/futari:execute` from `dev`; it starts with JM-201 and JM-202.

## v1.2 execution session 2026-11-23

- Started with `/futari:execute` (futari 1.0.2) after the owner merged contract PR #30 into `dev` with a merge commit (`59798be`). `node .futari/plan-gate.mjs verify`: PASS (snapshot `164b7bf0…` at `f1abbc7`); `planCommit` is reachable from `dev`.
- pstack `pstack@pstack-claude` 0.9.145. `check-playbooks.mjs`: "Every project playbook matches this pstack's playbooks." Invoked `pstack:poteto-mode` with the Skill tool and loaded `.agents/playbooks/futari-approved-plan.md` (standalone).
- Models per `.claude/pstack-models.md`: implementation workers `sonnet` (`pstack:poteto-agent`, each in its own worktree); no-comments and independent reviews `opus` (comment-sicko, thermos pair, then a fresh delta reviewer).
- Issues #31-#35 created for JM-201..JM-205 with exact `Futari-Plan`/`Futari-Task` markers (no existing v1.2 issue matched).
- Credentials (values not printed): `.env.local` holds a sandbox-prefixed `STRIPE_SECRET_KEY` (`sk_test_…`) and a `whsec_…` `STRIPE_WEBHOOK_SECRET`; the Stripe CLI is installed and paired with an account. Login to the sandbox is confirmed at the JM-203 smoke.
- Process notes:
  - EV-021 check 4's `.data/` assertion stays `it.todo` in JM-202, because the plan gives the `.gitignore` change to JM-203 with the store; JM-203 completes it.
  - `dev` CI failed once at `0b56670` on the carried ev-015 "375x812" layout test (two card boxes measured in parallel); the same commit passed on rerun. JM-204 may stabilize the measurement without changing the assertion.
  - The JM-203 fix-round worker was interrupted twice by API 529 (overloaded) errors and resumed in its own worktree.
  - Vertical slice gate: JM-203 live sandbox smoke 9/9 PASS on 2026-11-23 (log `jm-203-sandbox-smoke-20261123T100119Z.json`), with the owner performing the hosted-page steps. Exa used so far: 3 of 30.
  - The coordinator once wrote into a worker's worktree while the resumed worker was still committing there; the changes did not overlap and both were tested together. Rule kept since: never write in a worktree a live agent holds.

### CR-005: EV-009 image-id count and the Add-to-cart accessible name (plan revision of `kensaku-v1-2`)

- Observation (JM-203 worker, branch `jm-203-commerce-slice` at `8664ad3`): `tests/evals/ev-009-key-safety.test.ts:136` collects every `"id":"<64-hex>"` in the research stream and expects 6 image ids; with offer ids in `data-products` (REQ-017, EV-018) it finds 13. The file is outside JM-203's paths, and the worker's edit was refused. Separately, the approved Add-to-cart `aria-label` fails axe `label-content-name-mismatch` in EV-007.
- Owner decision (AskUserQuestion, 2026-11-23): "Prepare CR-004 (Recommended)", renumbered CR-005 because CR-004 is the proposed post-v1.1 eBay revision recorded below. D-059.
- Revision: JM-203 gains `tests/evals/ev-009-key-safety.test.ts` with one permitted edit (the regex) and a matching criterion; ARCHITECTURE's label wording. No other change.
- Independent review of `ede511b` (opus, read-only): READY; one MINOR and two NITs resolved as wording.
- Status: approved by the owner on the plan-revision card (snapshot `331cfd4b…` at `992d013`, record `3f42b46`); merged into `dev` by the owner as PR #38 (`e862e5b`). JM-203 then updated from `dev`.

### CR-006: EV-023 A3 when Exa returns no JPY offer, and run 1's evidence (plan revision of `kensaku-v1-2`)

- Observation (EV-023 run 1, 2026-11-23, code `c7ba58e`): A1, A2, A4, A5, A6, A7, A8 PASS; A3 BLOCKED (Q5 yielded 0 addable JPY offers; the re-ask was served from the research cache); every safety threshold 0; Exa plan-wide 12 of 30 requests, $0.165 of $0.40 (smoke counted at its $0.06 bound). The script's leak scan matched text it had copied from the case file (`sk_test_,` in the preconditions and the public Stripe test card numbers in the scenario steps), so it kept only a summary log.
- Owner decision (AskUserQuestion, 2026-11-23): "Revise plan, rerun". D-060.
- Revision: case file `blockedAllowances` for A3/Q5, the `scenariosPassing` exception, runRules and runLog notes; REQ-008 criterion 1; EVALUATION_PLAN EV-023 wording; D-060; R-41. No other change. JM-205 uses its third and last repair for the script fix.
- Status: under independent review.

### v1.2 execution ledger

| Task | Issue | Branch | PR | Tested revision | Status | Evidence / next action |
| --- | --- | --- | --- | --- | --- | --- |
| JM-201 | #31 | `jm-201-commerce-core` | #36 | `0d458b3` | merged (`57370f8`) | `.futari/evidence/JM-201.md` |
| JM-202 | #32 | `jm-202-stripe-adapter` | #37 | `9fcb8fb` | merged (`0b56670`) | `.futari/evidence/JM-202.md` |
| JM-203 | #33 | `jm-203-commerce-slice` | #39 | `5506864` | merged (`5f4d922`) | `.futari/evidence/JM-203.md`; live smoke 9/9 |
| JM-204 | #34 | `jm-204-commerce-ui` | (this PR) | `29b5597` | merge-ready after CI | `.futari/evidence/JM-204.md`; owner accepted the UI |
| JM-205 | #35 | — | — | — | pending | needs JM-204 |

## v1.1 planning session 2026-11-21

- Started with `/futari:bootstrap Kensaku v1.1 — change request on top of approved kensaku-mvp-v1`, with the owner's v1.1 brief (dark mode, image-first cards, real product images, CR-002 and merchant classification, Singapore investigation, engineering requirements).
- Worktree `.claude/worktrees/v1-1-plan`, branch `v1-1-plan`, from `dev` `a3a2894`.
- Owner decisions on AskUserQuestion cards: local image proxy with cache (D-029); collapse other-market offers (D-030); pre-approval spike ≤ 10 requests (D-028); classification additions and currency symbols (D-031, D-032); live budget ≤ 130 requests / ≤ $1.50 (D-034); MVP execution limits (D-035).
- Spike: 10 Exa requests, $0.11 of free credits (cap reached); image probe with no Exa use. Findings in `research/v1-1-spike-2026-11-21.md`. The Singapore cause was found and fixed in the plan (D-033).
- Independent review of `910ed96` (fable, read-only): CHANGES REQUIRED, 22 findings (3 blocking), all labels confirmed correct. All findings resolved (REVIEW.md, D-041). The image proxy became JM-103, and the later tasks were renumbered to JM-104 to JM-106.
- Frozen v1.1 inputs:
  - 79 classification cases;
  - 148 image cases (80 URL, 10 selection, 58 bytes);
  - 6 content answers (14 candidates);
  - 8 live queries;
  - 12 new live fixtures and a real MVP history fixture.

  A reference implementation of the written rules reproduces all 54 MVP labels, and the v1.1 rules change only L29 and Y03, recorded as supersessions. No single-rule mutation survives.
- `node evals/harness.mjs`: HARNESS OK (exit 0); `--strict` fails until JM-101 by design.
- Re-review of `ec779c7`: CHANGES REQUIRED narrowly (N1-N6), all 22 earlier findings confirmed resolved. N1 (leaked JSON in Exa answer text, also present in the accepted MVP run) was decided by the owner as "Cut and flag" (D-042). N1-N6 resolved (REVIEW.md).
- Final confirmation of `fd34674`: READY (advisory). Nits M1 and M2 resolved in the approval commit.
- Approval: the owner (d3F0g) selected "Approve plan" on the native card for `kensaku-v1-1` at `c356f9af2e9eb372f23712c6fa699ccf0967e011`. The card stated that approving replaces the `kensaku-mvp-v1` baseline. Recorded in `8186754` (`.futari/approval.json` only); `plan-gate verify`: PASS, snapshot `a6abc4f89279ae69760bfbf24d1ba59b10401de3ede849f5cccaba0c1d0ed6a9`.
- Publication: with the owner's authorization, `v1-1-plan` was pushed and PR #15 opened into `dev`. `CI` passed. `Futari contract` fails by design at the `Futari-Task` marker, as CR-001 PR #12 did (R-25).
- Next step: the owner merges PR #15 personally with a merge commit. Then run `/futari:execute` from `dev`; it starts with JM-101 and JM-102.

## v1.1 execution session 2026-11-21

- Started with `/futari:execute` (futari 1.0.2) after the owner merged contract PR #15 into `dev` with a merge commit (`c0597c8`). `node .futari/plan-gate.mjs verify`: PASS (snapshot `a6abc4f8…` at `c356f9a`); `planCommit` is reachable from `dev`.
- pstack `pstack@pstack-claude` 0.9.145. `check-playbooks.mjs`: "Every project playbook matches this pstack's playbooks." Invoked `pstack:poteto-mode` with the Skill tool and loaded `.agents/playbooks/futari-approved-plan.md` (standalone).
- Models per `.claude/pstack-models.md`: implementation workers `sonnet` (`pstack:poteto-agent`, each in its own worktree from `dev`); independent reviews `opus` (thermos pair, then a fresh delta reviewer).
- Issues #16-#21 created for JM-101..JM-106 with exact `Futari-Plan`/`Futari-Task` markers (a search found no existing v1.1 issue).
- Process notes:
  - Playwright binds port 8787 with no server reuse, so parallel workers wait for the port before e2e.
  - `Verdict: NOT VERIFIED` fails the contract check as an invalid marker (MVP observation, unchanged).

### v1.1 execution ledger

| Task | Issue | Branch | PR | Tested revision | Status | Evidence / next action |
| --- | --- | --- | --- | --- | --- | --- |
| JM-101 | [#16](https://github.com/futari-labs/kensaku/issues/16) | `jm-101-core-rules` | [#22](https://github.com/futari-labs/kensaku/pull/22) | `8e28262` (code reviewed at `b39e4f8`) | merged (`59ada31`), dev push CI green | `.futari/evidence/JM-101.md` |
| JM-102 | [#17](https://github.com/futari-labs/kensaku/issues/17) | `jm-102-theme` | [#23](https://github.com/futari-labs/kensaku/pull/23) | `a4a62bc` | merged (`5eb034c`) | `.futari/evidence/JM-102.md` |
| JM-103 | [#18](https://github.com/futari-labs/kensaku/issues/18) | `jm-103-image-proxy` | [#24](https://github.com/futari-labs/kensaku/pull/24) | `055f91c` | merged (`d3e598a`), dev push CI green | `.futari/evidence/JM-103.md` |
| JM-104 | [#19](https://github.com/futari-labs/kensaku/issues/19) | `jm-104-vertical-slice` | [#25](https://github.com/futari-labs/kensaku/pull/25) | `2551d51` (code reviewed at `a2cc9ea`) | merged (`1f6baaf`), dev push CI green; live smoke PASS (5 requests, $0.055) | `.futari/evidence/JM-104.md`; logs `.futari/evidence/live/jm-104-smoke-Q3.json`, `-Q4.json` |
| JM-105 | [#20](https://github.com/futari-labs/kensaku/issues/20) | `jm-105-product-cards` | [#27](https://github.com/futari-labs/kensaku/pull/27) | `20cd180` | merged (`870db8a`), dev push CI green; owner visual review accepted | `.futari/evidence/JM-105.md` |
| JM-106 | [#21](https://github.com/futari-labs/kensaku/issues/21) | `jm-106-live-acceptance` | [#28](https://github.com/futari-labs/kensaku/pull/28) | `16b7505` (code `66103e9`) | merged (`878c7cf`), dev push CI green (run 44922061821); EV-016 VERIFIED | `.futari/evidence/JM-106.md`; logs `.futari/evidence/live/ev-016-run-{1,2,3}-*.json` |

Plan-wide live Exa use during v1.1 execution: 71 of 130 requests, $0.805 of $1.50 reported cost (JM-104 smoke 5 / $0.055; EV-016 runs 24 / $0.28, 20 / $0.22, 22 / $0.25). Free credits only; $0 additional spend. All three permitted suite runs are used.

### v1.1 final acceptance

Completion condition (`.futari/plan.json`), observed 2026-11-22:
1. JM-101 to JM-106 are merged into `dev` through one PR each (#22, #23, #24, #25, #27, #28). `CI` and `Futari contract` were green on each PR head, and push CI was green on `dev` after each merge.
2. On the final `dev` head `878c7cf`, push CI run 44922061821 passed EV-001 to EV-007, EV-009 to EV-015, and EV-017, plus typecheck, lint, build, `node evals/harness.mjs`, and the component check. `node evals/harness.mjs --strict` exits 0 locally at that head (16 evaluations READY). `plan-gate verify` passes (snapshot `f8ff98c5…` at `47f813d`).
3. EV-016 passed in run 3, the last permitted run: 12 of 12 deterministic thresholds; owner audit of offers 29/30 and images 10/10. All three run logs and the audit are committed in `.futari/evidence/live/` and summarized in `.futari/evidence/JM-106.md`.
4. Owner product acceptance: recorded below.

| Requirement | Tasks | Evaluations | Evidence | Result |
| --- | --- | --- | --- | --- |
| REQ-001 Ask and stream | JM-104, JM-105 | EV-006, EV-007 | `JM-104.md`, `JM-105.md` | pass |
| REQ-002 Cited comparison (with the D-042 cut) | JM-104, JM-105 | EV-004, EV-007, EV-012, EV-015 check 10 | `JM-104.md`, `JM-105.md` | pass |
| REQ-003 Merchant offers | JM-101, JM-105 | EV-001 (54, L29/Y03 superseded), EV-002, EV-011, EV-007 | `JM-101.md`, `JM-105.md` | pass |
| REQ-004 Currency ranking | JM-101 | EV-003 | `JM-101.md` | pass |
| REQ-005 Failure recovery | JM-104 | EV-006 | `JM-104.md` | pass |
| REQ-006 Spend guard | JM-104 | EV-005 (image loads use no budget) | `JM-104.md` | pass |
| REQ-007 Local and key safety | JM-103, JM-104, JM-105 | EV-009 (CSP, image cache), EV-014, EV-007 | `JM-103.md`, `JM-104.md` | pass |
| REQ-008 Live acceptance | JM-106 | EV-016 | `JM-106.md`, `live/ev-016-run-3-*` | pass |
| REQ-009 Persistent history | JM-105 | EV-007, EV-015 check 8 (frozen MVP payload) | `JM-105.md` | pass |
| REQ-010 Frontend quality | JM-102, JM-105 | EV-007, EV-010, EV-015; owner visual review | `JM-102.md`, `JM-105.md` | pass |
| REQ-011 Theme | JM-102 | EV-010 | `JM-102.md` | pass |
| REQ-012 Image-first cards | JM-101, JM-104, JM-105 | EV-012, EV-015, EV-017 | `JM-101.md`, `JM-104.md`, `JM-105.md` | pass |
| REQ-013 Real product images | JM-101, JM-104, JM-105, JM-106 | EV-013, EV-015, EV-016 image audit | `JM-101.md`, `JM-106.md` | pass |
| REQ-014 Image proxy safety | JM-103 | EV-014 | `JM-103.md` | pass |
| REQ-015 Market relevance | JM-104, JM-105, JM-106 | EV-017, EV-015, EV-016 (4/4 SG) | `JM-104.md`, `JM-106.md` | pass |
| REQ-016 Non-merchant pages | JM-101, JM-106 | EV-011 (79/79), EV-001, EV-016 (0 search pages) | `JM-101.md`, `JM-106.md` | pass |

**Owner product acceptance:** accepted by the owner (d3F0g) on 2026-11-22 through the native AskUserQuestion card. The card showed the requirement-to-evidence summary and the known limits: CR-004 (eBay item pages), the Japan Kindle query showing no offers (R-21), and occasional prices in Exa reason text (R-20). Selection: "Accept v1.1". CR-004 and the v1.1 follow-ups stay proposed for a later revision. Promotion to `main` and deployment remain the owner's decisions, outside this plan.

Logged interpretations (non-material, reviewer-confirmed):
- JM-102 `public/theme-init.js` starts with `/* global document */`. The criterion's literal `/* global document, localStorage */` fails lint (no-redeclare).
- After the single-parser review fix, theme-init.js is the only storage parser, and theme.ts owns the key and applying the theme.
- JM-105 owner visual review (native card, "Accept, drop repeated brand"): REQ-012, REQ-013 (alt text) and EV-015 check 3 read "brand and name" as the product name with the brand shown once (`productTitle`). This is owner-directed, not a plan change; the frozen docs are unchanged.

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
| JM-002 | [#2](https://github.com/futari-labs/kensaku/issues/2) | `jm-002-core-rules` | [#8](https://github.com/futari-labs/kensaku/pull/8) | `73c0c8f` | merged (`521399c`), dev push CI green | `.futari/evidence/JM-002.md` |
| JM-003 | [#3](https://github.com/futari-labs/kensaku/issues/3) | `jm-003-exa-adapter` | [#9](https://github.com/futari-labs/kensaku/pull/9) | `c8491d3` | merged (`be91f1d`), dev push CI green (run 44800483182) | `.futari/evidence/JM-003.md` |
| JM-004 | [#4](https://github.com/futari-labs/kensaku/issues/4) | `jm-004-vertical-slice` | [#10](https://github.com/futari-labs/kensaku/pull/10) | `7b8bdec` | merged (`ed37686`), dev push CI green (run 44807130246); vertical slice milestone passed | `.futari/evidence/JM-004.md`; live smoke logs in `.futari/evidence/live/` |
| JM-005 | [#5](https://github.com/futari-labs/kensaku/issues/5) | `jm-005-frontend` | [#11](https://github.com/futari-labs/kensaku/pull/11) | `d8b30e2` | merged (`90a0218`), dev push CI green (run 44843154968) | `.futari/evidence/JM-005.md`; owner visual review accepted 2026-11-21 |
| JM-006 | [#6](https://github.com/futari-labs/kensaku/issues/6) | `jm-006-live-acceptance` | [#13](https://github.com/futari-labs/kensaku/pull/13) | `4f297bb` | verified, merging | `.futari/evidence/JM-006.md`; thermos APPROVE at 7bfa54f; EV-008 run 1 (14 requests, $0.15) passed; owner audit 15/16 |

## Change requests

### CR-001: accept spaces inside citation markers (proposed, needs owner decision through a reviewed plan revision)

- Observation: in the JM-004 live smoke, Exa's `/answer` wrote markers such as `[2, 5, 6]` in Q2. The frozen rule in `evals/cases/citations.json` (`'[' n (',' n)* ']'`, protected) does not match them, so the Q2 comparison resolved 0 of 8 citations and every paragraph was flagged uncited. Q1 used `[4,5]` and resolved normally. Evidence: `.futari/evidence/live/jm-004-smoke-Q2.json`.
- Impact: REQ-002 ("cited comparison") is met by the code as approved but fails for real answers that use spaces; owner product acceptance at JM-006 would likely reject it. EV-008 thresholds do not measure citations, so EV-008 can pass while this gap remains.
- Recommendation: amend the rule to `'[' n (\s* ',' \s* n)* ']'` (optional whitespace around commas, and optionally inside the brackets), add one live-derived citation case for the Q2 text, and let JM-006 (which may change `src/core/`) implement it. This changes a protected evaluation input, so it requires a reviewed plan revision and a fresh owner approval through `/futari:bootstrap`; no agent edits the frozen case file.
- Status: resolved. Revision approved on the plan-review card (approval at plan commit `2866477`, snapshot `c4bce636…`), merged into `dev` by the owner with a merge commit (PR #12, `034f4fe`), implemented in JM-006 (EV-004 8/8, `harness --strict` 0). Live run 1 resolved citations in all six answers.

### CR-002: search-results pages reported as product listings (proposed post-MVP revision)

- Observation: EV-008 run 1 displayed Q5-O1, a Rakuten Ichiba search-results page (`search.rakuten.co.jp/search/mall/...`), as a merchant offer. Exa reported `isProductListing: true`; the approved aggregator list has `product.rakuten.co.jp` only. The owner audit failed it (Direct merchant); the run still passed at 15/16.
- Recommendation: a reviewed revision adding search-results URL handling (for example `search.rakuten.co.jp` on the aggregator list and a path rule for `/search`), with frozen cases from the run-1 log.
- Status: owner chose "Follow-up after MVP" (2026-11-21). Not part of `kensaku-mvp-v1`. Included in proposed plan `kensaku-v1-1` as rule 5b (D-031, REQ-016, EV-011 case N33).

### CR-003: malformed-answer note moves from JM-104 to JM-105 (plan revision of `kensaku-v1-1`)

- Observation: JM-104's criterion "the comparison shows the malformed-output note when truncated" needs `src/web/app/Comparison.tsx` or `App.tsx`, which are outside JM-104's approved paths. The worker plumbed and tested the truncated flag to the page (`data-comparison`, `RunView.comparisonTruncated`) without rendering a note. Both JM-104 reviewers confirmed this; the code-quality reviewer flagged it as user-visible.
- Owner decision (AskUserQuestion, 2026-11-21): "Move note to JM-105". D-043.
- Revision:
  - JM-104 criterion 3 now ends at carrying the flag to the client.
  - JM-105 gains the note criterion.
  - EV-015 gains REQ-002, two scenarios (one a stubbed UI stream inside JM-105's test paths), and check 10.
  - No other change.
- Status: approved by the owner on the plan-revision card (snapshot `f8ff98c5…` at `47f813d`); merged into `dev` by the owner as PR #26 (`19035b4`). JM-104 then updated from `dev` and merged.

### CR-004: eBay item pages reach the offer list (proposed post-v1.1 revision)

- Observation: EV-016 run 3 displayed Q2-O4, an ebay.com item page (`https://www.ebay.com/itm/167051732563`), as a merchant offer. The owner audit failed it on Direct merchant: it is a marketplace listing. The frozen rule 5a list holds carousell.sg, carousell.com, jp.mercari.com, and auctions.yahoo.co.jp only. Run 3 still passed: 29 of 30 offers, with up to 3 failures allowed.
- Recommendation: a reviewed revision that adds ebay.com (and regional eBay hosts) to the second-hand marketplace list, with frozen cases from the run-3 log.
- Status: proposed; not part of `kensaku-v1-1`.

### v1.1 deferred follow-ups (non-blocking review findings)

- EV-016 suite (`scripts/live/`):
  - `thresholds.ts` should count `analysis.candidateProblems`. Run 3 had 0, so the v1.1 verdict is unaffected.
  - Type every threshold key from the frozen file and fail before the first query.
  - Record body-read failures in the capture as unexpected errors.
  - Move the record-building glue into a pure, tested `recordOf` and extend the offline e2e through analysis.
  - Small duplications and test nits.
- Image proxy: index size after a prune during an in-flight fetch; the serve-level catch logs nothing (disk errors only).
- Cards: rare `productTitle` quirks with combining marks or fullwidth brands; the market guess for pre-v1.1 history is a currency vote.

### Deferred follow-ups (non-blocking review findings)

- Live suite (`scripts/live-acceptance.ts`, `tests/research/`): include candidate problems in the log's threshold summary; write the raw log before post-processing so a crash cannot drop a paid query; model stop reasons as a typed value shared with the smoke; iterate the spec once; move the shared live modules out of `tests/` into `scripts/live/` and rename `Smoke*`; count failed attempts in run totals; derive the run number from a durable counter; exit non-zero on a failed threshold; remove the temp server directory.
- Citations (`src/core/citations.ts`): fix the stale `segmentMarkers` comment; a paragraph made only of dropped markers shifts UI paragraph indexes; `[[9]1]` renders `[1]` while counted uncited (both pre-existing).
- Web (`src/web/app/messages.ts`): drop the `runStateOf` `cancelled` option once `tests/server/stream-contract.test.ts` may change; citation popover tab order returns to the end of the body; fixture footers show the monthly figure until `/api/health` answers.
- Risks: R-15 (other citation marker forms, likely full-width brackets on Japanese answers); the Singapore query Q3 showed only USD offers from US sites.

## Milestone verification

- MVP (JM-005, JM-006): PASSED 2026-11-21 pending the final `dev` CI run after PR #13. EV-008 run 1 at code `7bfa54f`: 4/6 queries with a merchant offer, 16/16 revalidated, owner audit 15/16 (93.75%), 0 fabricated, 0 unexpected errors, 14 requests, $0.15. Live spend across the plan: 19 requests, $0.205 of 120 / $2.00.

## Final acceptance

| Requirement | Tasks | Evaluations | Evidence | Result |
| --- | --- | --- | --- | --- |
| REQ-001 Ask and stream | JM-004, JM-005 | EV-006, EV-007 | `.futari/evidence/JM-004.md`, `JM-005.md` | pass |
| REQ-002 Cited comparison | JM-002, JM-004, JM-006 | EV-004 (8 cases), EV-007 | `JM-002.md`, `JM-006.md`; live run 1 citations | pass |
| REQ-003 Merchant offers | JM-002, JM-004 | EV-001, EV-002 (54/54); EV-008 audit | `JM-002.md`, `live/ev-008-run-1-audit.md` | pass (Q5-O1 extraction miss, CR-002) |
| REQ-004 Currency ranking | JM-002 | EV-003 | `JM-002.md` | pass |
| REQ-005 Failure recovery | JM-004 | EV-006 | `JM-004.md` | pass |
| REQ-006 Spend guard and cache | JM-003, JM-004 | EV-005 | `JM-003.md`, `JM-004.md` | pass |
| REQ-007 Local and key safety | JM-004, JM-005 | EV-009, EV-007 | `JM-004.md`, `JM-005.md` | pass |
| REQ-008 Live acceptance | JM-006 | EV-008 | `JM-006.md`, `live/ev-008-run-1-*.json` | pass |
| REQ-009 Persistent history | JM-005 | EV-007 | `JM-005.md` | pass |
| REQ-010 Frontend quality | JM-001, JM-005 | EV-007, owner visual review | `JM-001.md`, `JM-005.md` | pass |

**Owner product acceptance:** accepted by the owner (d3F0g) on 2026-11-21 through the native AskUserQuestion card. Question: "do you accept the MVP?" after the requirement-to-evidence table and known limits (CR-002, R-15, SG query showing USD offers). Selection: "Accept MVP". Promotion to `main` and deployment remain the owner's and are outside this plan.

- Vertical slice (JM-001..JM-004): PASSED 2026-11-21. All four merged with CI and Futari contract green on each PR head and on `dev` after each merge; JM-004 live smoke Q1 2 revalidated merchant offers, Q2 offers for 2 candidates (citations unresolved, CR-001); 5 live requests, $0.055; zero-cost browser check of the live path by the JM-004 reviewer.
- Process note: editing a PR body re-triggers `Futari contract`; finish body edits before the final check watch (PR #10 merged while a re-triggered run was pending; it then passed on the same head).

Record actual slice and integration verdicts and remaining blockers. Never infer completion from agent activity.
