# Pre-execution review

Reviewer: independent Claude subagent (model `fable`, "strongest judgment" in `.claude/pstack-models.md`), read-only, with no implementation authority. Reviewed artifact: branch `bootstrap-resume` at commit `551288c3fd18429a2710284b97acda397218aabd`. Date: 2026-11-21.

Method used by the reviewer: read every contract document, `plan.json`, the case files, and the fixtures; ran `node .futari/plan-gate.mjs check` and `node evals/harness.mjs`; applied the written classification rules to all cases with an inline script; recomputed the citation and ranking expectations.

Verdict on `551288c`: **CHANGES REQUIRED** (1 blocking, 9 should-fix, 5 nits). Advisory only; the owner approves.

## Findings and resolutions

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | BLOCKING | Rule 9 said "remove punctuation", which turns "Amazon.com" into `amazoncom` and makes L11 and L33 contradict their labels. | Rule 9 now replaces every non-letter, non-digit character with a space, with worked examples; L15 rationale corrected. A throwaway reference implementation of the written rules now agrees with 54/54 labels. |
| 2 | SHOULD-FIX | JM-004 and JM-006 could not fix `src/exa` or `src/core` bugs found live; no interface signatures for parallel JM-002/JM-003. | Added "Interfaces and data" signatures to ARCHITECTURE; added `src/core/`, `src/exa/` and their tests to JM-004 and JM-006 scopes, with rule changes still pinned by the frozen cases. |
| 3 | SHOULD-FIX | EV-005 run-level checks need the pipeline but belonged only to JM-003. | EV-005 split into unit level (JM-003) and run level (JM-004); test file and EV-005 added to JM-004. |
| 4 | SHOULD-FIX | No coherent fixture run for pipeline and e2e tests. | Defined named fixture scenarios in `tests/fixtures/scenarios/` (baseline `xm5-us`, `xm5-sg`, `xm5-jp` plus error, slow, cancel), selectable only in fixture mode; ownership given to JM-003, extendable by JM-004/JM-005. |
| 5 | SHOULD-FIX | Test configs and some web paths frozen to JM-001. | `playwright.config.ts` and `vitest.config.ts` added to JM-004 and JM-005; JM-005 scope widened to `src/web/` and `components.json`; JM-001 adds `tests/e2e/` smoke and aliases shadcn hooks under `src/web/lib/hooks`. |
| 6 | SHOULD-FIX | EV-009 checked `dist/` before any build; browser storage split oddly. | EV-009 builds into a temporary directory itself; browser storage moved to EV-007, which now covers REQ-007. |
| 7 | SHOULD-FIX | "Required checks" unenforceable on GitHub Free; merged `dev` head never tested. | CI also runs on pushes to `dev`; EXECUTION_PLAN and handoff define the process gate (`gh` confirms CI and Futari contract green on the PR head, branch current with `dev`, and green CI on the new `dev` head). |
| 8 | SHOULD-FIX | Largest uncertainty (Exa-generated identifiers, production query template, `/answer` `userLocation`) tested late. | Slice smoke now runs Q1 and the open-ended Q2 (≤ 10 requests); `userLocation` on `/answer` recorded as unverified with a fallback; research note lists the untested query template. |
| 9 | SHOULD-FIX | EV-008 reruns could replay the cache or cherry-pick. | `live-acceptance.json` `runRules`: fresh cache per run, every log committed, rerun only after a recorded fix or BLOCKED run, last run decides; revalidation described as a self-consistency check. |
| 10 | SHOULD-FIX | PROGRESS.md stale. | Rewritten to the current state. |
| 11 | NIT | Underdetermined host matching, tokenization, fallbacks, ISO check, third-candidate and retry policy, sort order. | Each defined in ARCHITECTURE (host plus suffix and optional path prefix, explicit lists, Unicode tokenization, title fallback, missing merchant fails rule 9, three ASCII letters, candidate 3 only if 1-2 yield no offers, one retry per run, code-point order). |
| 12 | NIT | `merchantHost` undefined; R03 inconsistent. | Defined as hostname minus one leading `www.`; R03 uses `online.challenger.sg`, and its expected order is now b, a, c. |
| 13 | NIT | Server cannot deliver `cancelled`; dev origin conflicts with the guard. | `cancelled` is client-derived; the server aborts and logs. `KENSAKU_DEV=1` allows the Vite origins. |
| 14 | NIT | Small inconsistencies (EXECUTION_PLAN row, research Method line, `.mcp.json` `@latest`, live-log timing). | All fixed; JM-001 pins `shadcn@4.23.0` in `.mcp.json`; live logs must be committed at or before `Tested-Commit`. |
| 15 | NIT | Thin coverage; mild overengineering. | Added Y11-Y14; harness fails if a test file does not load its frozen case file; tests assert the case count. Removed the configurable bind host and the ledger mutex: a second concurrent run now gets 409. |

## Accepted risks

R-1 to R-13 in `RISKS.md`, in particular: offers depend on Exa extraction quality (R-1, R-2), a 6-query live suite is a sanity gate rather than a statistical guarantee (R-3), and `main`/`dev` protection is process-only on GitHub Free (R-13, D-023).

## Re-review

The same reviewer re-reviewed commit `cc3ccc361bd74a227443078c9a40584978606cac` (read-only). It confirmed that findings 1-12, 14, and 15 were resolved. It re-applied the rules to all 54 cases with 0 mismatches and found R03 correct. It reran the gate and the harness (both pass). Verdict: **CHANGES REQUIRED, narrowly**. The reviewer stated that once A and B were fixed it would consider the contract READY (advisory).

| # | Severity | Finding | Resolution (in the approval commit) |
| --- | --- | --- | --- |
| A | SHOULD-FIX | Harness readiness paths (`src/core/offers.ts`, `src/exa/budget.ts`, `src/server/app.ts`, and others) were not named by the contract's interface block. | ARCHITECTURE now has a binding file layout naming every path the harness checks; `RequestBudget` lives in `src/exa/budget.ts`; JM-002 and JM-003 acceptance criteria reference the layout. |
| B | SHOULD-FIX | The cancel resolution had not reached plan.json REQ-005, EV-006, or the EVALUATION_PLAN EV-006 row. | All three now treat cancel as client-derived: the server aborts the Exa call, writes no further parts, and logs `cancelled`; the client state is checked in EV-007. |
| C | NIT | 409 had no user-visible state; lock release unspecified. | The lock is released in `finally` on completion, failure, or abort; the client shows "A research run is already in progress"; EV-006 asserts the lock is released and the next request succeeds after every scenario. |
| D | NIT | Leftovers: "non-loopback bind" wording, `budget_exhausted` mapping, `uncitedParagraphs` type versus count, nominal `validate` stage. | Wording fixed; `budget_exhausted` ends the offers stage early with a "Not searched" note (not an error); EV-004 compares `.length`; the stage responsibilities are stated. |

These A-D fixes were verified locally (`plan-gate check` PASS, harness OK, the reference rule check 54/54) but were not sent through a third review pass.
