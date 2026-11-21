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

R-1 to R-14 in `RISKS.md`, in particular: offers depend on Exa extraction quality (R-1, R-2), a 6-query live suite is a sanity gate rather than a statistical guarantee (R-3), GitHub enforces no protection on `main` or `dev` (R-13), and agents act with the owner's admin credentials (R-14).

## Re-review

The same reviewer re-reviewed commit `cc3ccc361bd74a227443078c9a40584978606cac` (read-only). It confirmed that findings 1-12, 14, and 15 were resolved. It re-applied the rules to all 54 cases with 0 mismatches and found R03 correct. It reran the gate and the harness (both pass). Verdict: **CHANGES REQUIRED, narrowly**. The reviewer stated that once A and B were fixed it would consider the contract READY (advisory).

| # | Severity | Finding | Resolution (in the approval commit) |
| --- | --- | --- | --- |
| A | SHOULD-FIX | Harness readiness paths (`src/core/offers.ts`, `src/exa/budget.ts`, `src/server/app.ts`, and others) were not named by the contract's interface block. | ARCHITECTURE now has a binding file layout naming every path the harness checks; `RequestBudget` lives in `src/exa/budget.ts`; JM-002 and JM-003 acceptance criteria reference the layout. |
| B | SHOULD-FIX | The cancel resolution had not reached plan.json REQ-005, EV-006, or the EVALUATION_PLAN EV-006 row. | All three now treat cancel as client-derived: the server aborts the Exa call, writes no further parts, and logs `cancelled`; the client state is checked in EV-007. |
| C | NIT | 409 had no user-visible state; lock release unspecified. | The lock is released in `finally` on completion, failure, or abort; the client shows "A research run is already in progress"; EV-006 asserts the lock is released and the next request succeeds after every scenario. |
| D | NIT | Leftovers: "non-loopback bind" wording, `budget_exhausted` mapping, `uncitedParagraphs` type versus count, nominal `validate` stage. | Wording fixed; `budget_exhausted` ends the offers stage early with a "Not searched" note (not an error); EV-004 compares `.length`; the stage responsibilities are stated. |

These A-D fixes were verified locally (`plan-gate check` PASS, harness OK, the reference rule check 54/54).

## Third review (fresh reviewer)

Requested by the owner after the first approval card ("Request changes"). A new, independent reviewer (model `fable`, read-only, no implementation authority, read-only `gh` GETs allowed) reviewed commit `89f79016b697d3b54257e62e2588cb6a3b866ac9`. The verdict was **CHANGES REQUIRED, narrowly**, with no blocking findings.

It verified that finding 1 and A-D were resolved and that findings 2-15 were still resolved. It re-applied the rules to all 54 cases (0 mismatches) and confirmed R01-R04 and C01-C06. It reproduced every GitHub fact (private, Free plan, rulesets and protection return 403, admin token, auto-merge enabled). It found no threshold, case, or Exa cap lowered since `551288c`; the only one-facet relaxations were recorded review resolutions.

| # | Severity | Finding | Resolution in `2b9140b` |
| --- | --- | --- | --- |
| S1 | SHOULD-FIX | Forbidden-actions text did not carve out the approved default-branch change (D-024 step 2, D-025). | EXECUTION_PLAN and PSTACK_HANDOFF allow only that one-time change, made by bootstrap and never by a task worker. |
| S2 | SHOULD-FIX | JM-003 needed `src/core/types.ts`, which only the parallel JM-002 created. | JM-001 creates `src/core/types.ts` from the ARCHITECTURE declarations; JM-002 and JM-003 do not change it. |
| N1-N5 | NIT | EV-007 spec path unnamed; stale references; JM-001 missing `pnpm test:e2e`; `workflow`-scope consequence and `allow_rebase_merge` unstated; case-file wording. | All fixed. |

The same reviewer then checked `2b9140b8ffb82ef5faac3103920733c196af4075`: **READY** (advisory). Gate and harness pass, no new inconsistency, nothing weakened. Residual non-blocking nits, accepted as interpretations: "verbatim" for `src/core/types.ts` allows adding `export` keywords; the EXECUTION_PLAN summary row for JM-001 omits `src/core/types.ts` (plan.json is authoritative); `REVIEW.md` is a record, not a frozen input.

## Plan revision CR-001 (citation markers with spaces)

Trigger: the JM-004 live smoke (`.futari/evidence/live/jm-004-smoke-Q2.json`) showed Exa writing `[2, 5, 6]`; the approved rule rejected it, so the Q2 comparison resolved 0 of 8 citations. On 2026-11-21 the owner selected "Revise plan" (AskUserQuestion). Decision D-026; risk R-15.

Independent reviewer: fresh opus thermo-nuclear reviewer with no implementation authority, reviewing the uncommitted revision on branch `cr-001-citation-spaces` (base `dev` 90a0218). Verdict: **READY**, no blocking findings, three should-fix items, all resolved before commit:

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | `evals/harness.mjs` never reads `citations-spaced.json` or fixture A4, so JM-006 could skip the spaced cases with EV-004 still READY, and A4 escaped the fixture credential scan. | Harness validates the spaced cases (and so scans A4); EV-004 shows "spaced cases pending JM-006" by default (dev CI stays green) and is INVALID under `--strict`, which is now a JM-006 verification command and part of the EV-004 pass rule. Verified: default exit 0, `--strict` exit 1 on this tree. |
| 2 | Rule ambiguities: leading zeros, undefined "blank line", no case for tabs, newlines inside brackets, or a stripped spaced marker. | Rule defines n as ASCII digits read as an integer and rendered without leading zeros, and defines a blank line; C07 gained `[1,\t3]`, `[ 9 ]` (stripped), `[05]` and `[1,\n2]` paragraphs. Labels recomputed with an implementation independent of `src/core` and checked by hand (2 unresolved, 2 uncited, 5 sources). |
| 3 | `plan.json` re-serialization buried the real edits in whitespace changes; the new rule's codified behaviors were not called out. | `plan.json` edited textually (original formatting kept); `ruleRevision` and D-026 name the three codified behaviors. |
| - | Non-blocking: A4 field provenance; R-15 should name Q5 (Japanese query, full-width brackets); EVALUATION_PLAN fixture count; PSTACK_HANDOFF step wording. | All applied. |

Reviewer-confirmed facts: C01-C06 labels unchanged under the amended rule; C08 (0 unresolved, 0 uncited, 5 sources) matches the reviewer's own implementation and resolves 0 markers under the old rule; A4 `request` and `response` are byte-faithful (`deepStrictEqual`) to the logged exchange and contain no key; no thresholds, budgets, permissions or other evaluations changed; on this tree `plan-gate check` PASS, harness OK, EV-001..004 and `pnpm test` (290) pass.

Publication: the `Futari contract` check fails any PR that changes protected files or `approval.json`, by design. After the owner approves the revised baseline, the approval is recorded with `approve --replace` on this branch and a PR into `dev` is opened; the owner merges it personally with a **merge commit** (not squash or rebase, so `approval.planCommit` stays reachable from `dev`). Agents do not merge it.
