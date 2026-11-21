# FutariLabs progress

Phase: execution complete pending the final `dev` CI run. Plan `kensaku-mvp-v1`, revision CR-001 (approval at plan commit `2866477`, snapshot `c4bce63625eab7d095e1a70737497c524de12cace00bfde4ffd978fbe96cdb36`; original approval `3fe529f`, snapshot `77dafb5d…` at `eed64a9`).

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
- Status: owner chose "Follow-up after MVP" (2026-11-21). Not part of `kensaku-mvp-v1`.

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
