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

## Plan kensaku-v1-1: independent review

Reviewer: fresh independent Claude subagent (model `fable`, "strongest judgment" in `.claude/pstack-models.md`). It was read-only, had no implementation authority, made no Exa calls, and wrote throwaway scripts only under the job's temporary directory. Reviewed artifact: branch `v1-1-plan` at `910ed969aa2c54be5a640505f4225ab31bf616ed` against `dev` `a3a2894`. Date: 2026-11-21.

Method: read every contract document, `plan.json`, the case files, fixtures, harness, and spike scripts, and the existing `src/` and `tests/` where task boundaries depended on them. It ran `plan-gate check` and the harness in both modes. It wrote its own implementation of the written rules, without reading `src/core`, and recomputed every label: MVP 54/54 under the MVP rules; only L29 and Y03 differ under v1.1; v1.1 57/57; image 57/7/51; content 9/9. It ran single-rule mutation checks, re-derived the committed live logs under the v1.1 rules, verified fixture provenance and the archive, and checked the CSP against the built MVP `dist/`.

Verdict on `910ed96`: **CHANGES REQUIRED** (3 blocking, 13 should-fix, 6 nits). Every label was correct; the problems were coverage, task boundaries, and security details. Advisory only; the owner approves.

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | BLOCKING | JM-101 could not typecheck: `src/web/app/schemas.ts` enumerates evidence categories, but it was outside JM-101's paths. | `src/web/app/schemas.ts` added to JM-101 (category list only). |
| 2 | BLOCKING | `tests/research/live-smoke-revalidation.test.ts` re-derives the MVP logs. Under rule 5b, Q5-O1 no longer reproduces, which turns `pnpm test` red outside JM-101's scope. | Test and `tests/research/revalidate.ts` added to JM-101. EVALUATION_PLAN "Historical live logs": MVP logs are history, and the test asserts exactly the Q5-O1 difference. |
| 3 | BLOCKING | EV-011 failed to discriminate 17 of 39 single-rule mutations. | Synthetic cases Z17-Z38 added (one per list entry, token, and symbol; a `search.` host without a search path; percent-encoded and uppercase segments). 79 cases. Rerunning the reviewer's `mutate.mjs` detects every mutation. |
| 4 | SHOULD-FIX | EV-013 and EV-012 also under-discriminated (deny tokens, file-name-only matching, length boundary, tiers, duplicates, cap, `no-dimensions`, 5 MiB boundary, content edge cases). | Added one URL case per deny token, plus directory-token, encoded, undecodable, trailing-slash, http, 2048 and 2049 cases (80 URL cases). Added synthetic selection cases for tiers, duplicates, and the cap, and a V6 case (10). Added aspect, no-dimensions, 5 MiB boundary, and precedence bytes cases (58). Added content P04-P06 (14 candidates). Rerunning `imgmut.mjs` detects every mutation. |
| 5 | SHOULD-FIX | MVP requirement and evaluation texts were weakened while labelled "unchanged", and EV-007's checks existed only in a historical commit. | `plan.json` carries the MVP texts verbatim from the archived plan, with marked "(v1.1)" deltas (generated by script from `docs/futari/archive/kensaku-mvp-v1/plan.json`). EVALUATION_PLAN inlines the full amended EV-007 list. |
| 6 | SHOULD-FIX | The image proxy was reachable cross-site: an `<img>` GET carries no `Origin`. | `Sec-Fetch-Site` other than `same-origin` gets 403, and every response carries `Cross-Origin-Resource-Policy: same-origin`. REQ-014 and EV-014 check 10. |
| 7 | SHOULD-FIX | Address policy gaps (IPv6 special ranges, ports, literal hosts); pinning untested at connector level. | IPv6 allowlist 2000::/3 minus Teredo, documentation, and 6to4; ports 80 and 443 only; literal and encoded hosts checked. `node:http(s)` with a `lookup` override is named. EV-014 checks 2, 3, and 6, including a real connector test with a `.invalid` host. |
| 8 | SHOULD-FIX | The cache lifecycle contradicted itself; no pruning or cap; transient failures cached 24 h. | One lifecycle: 7-day reuse then refetch while registered; pruning 30 days after the last registration; 500 MB cap with oldest-first eviction; 24 h for I3 rejections and 10 min for upstream failures. ARCHITECTURE, PRODUCT_SPEC, REQ-014, and EV-014 check 11 agree. |
| 9 | SHOULD-FIX | Layout thresholds conflicted, and the mobile floor was unreachable with current padding. | Full-bleed image in REQ-012, ARCHITECTURE, and EV-015. Mobile floor is now "at least 300 px wide (225 px tall)". JM-105 may override container width and padding only through `className`. |
| 10 | SHOULD-FIX | The extended schema degraded model identifiers (V8), with no evaluation. | The last 2 approved spike requests tested a tighter description: V9 gave a clean "MX Vertical", and V10 gave a weak JP identifier. The tighter description was adopted, and the binding schema is V9's frozen request (EV-017). V9 also exposed leaked structured output in a reason, so a malformed-reason rule was added (P04, P06). R-21 updated. |
| 11 | SHOULD-FIX | EV-016 thresholds lacked denominators and margin; the smoke had no failed-versus-blocked rule. | Minimums of 12 offers and 8 images. Failure allowances are floor(10%) for offers and max(1, floor(10%)) for images. Rule I3's aspect limit tightened to 1.8 on probe evidence, which removes the Logitech logo card. Expected outcomes are recorded in advance (Q6). The smoke is Q3/Q4 only, with explicit PASS, BLOCKED, and FAIL outcomes. |
| 12 | SHOULD-FIX | Deleting the MVP approval in an agent commit has the effect of an automatic `--replace`. | The approval card question states that it replaces the `kensaku-mvp-v1` baseline, and D-027's source is that selection. Without "Approve plan" nothing is replaced: the live approval only disappears from `dev` when the owner merges the contract PR. |
| 13 | SHOULD-FIX | `completionCondition` omitted EV-017 and claimed CI runs `--strict`. | Fixed: EV-017 included; `--strict` required locally at the final head; `ci.yml` unchanged. |
| 14 | SHOULD-FIX | The MVP-history fixture would be written by the task under test. | A real `kensaku.history.v1` value was captured from the accepted build (`src` tree identical to `a3a2894`) and frozen as `evals/fixtures/history/mvp-history-xm5-sg.json`. It is protected and validated by the harness. |
| 15 | SHOULD-FIX | JM-103 was too large. The graph contradicted "nothing else overlaps". JM-103 lacked the EV-007 spec and `scripts/live-acceptance.ts`. | The image proxy is now JM-103. The slice is JM-104, with the EV-007 spec and `scripts/live-acceptance.ts` in scope. JM-102 may overlap one slice task (disjoint scopes) and no longer edits the EV-007 spec. Cards are JM-105, live is JM-106. |
| 16 | SHOULD-FIX | EV-010 could pass with a later flip. EV-017 compared code to a prose copy. | EV-010 check 3 uses a MutationObserver through load. EV-017 compares against frozen requests (V9 schema; V2 and V3 queries). |
| 17 | NIT | I1 and I3 lacked verdict precedence and decode and trailing-slash handling. | Written into the case-file rules and ARCHITECTURE; cases U74-U80 and B57-B58. |
| 18 | NIT | Budget arithmetic; the MVP live script stayed runnable. | The plan-wide cap governs (`live-acceptance-v1-1.json` `budget.planTotal`). Smoke is 2 queries × 5 = 10. The MVP script is forbidden during v1.1 and removed by JM-106. |
| 19 | NIT | `public/theme-init.js` would fail lint without browser globals. | JM-102 criterion: a `/* global document, localStorage */` comment; `eslint.config.js` unchanged. |
| 20 | NIT | Harness gaps: no amount check for v1.1 offers; V6 unreferenced; scan only of referenced fixtures. | Amount check added; V6 used by I08; every file in `evals/fixtures/exa-live/` and `evals/fixtures/history/` is scanned. |
| 21 | NIT | Stale MVP task references and duplicated type declarations in ARCHITECTURE; JM-101 omitted `SearchHit.image`. | MVP references marked historical; the v1.1 block states that it replaces the MVP declarations; JM-101 criterion names `SearchHit.image`. |
| 22 | NIT | Raw versus normalized card fields; D-040 overstated compatibility; "From <lowest>" ambiguous; no check on `index.css` and the component script. | Cards read only entry-level fields. D-040 is forward-only. The summary says "lowest listed price". `scripts/check-components.mjs` was removed from JM-105's paths, and reviewers check that the `index.css` variables are unchanged. |

Verification after the resolutions, on the working tree:
- `plan-gate check`: PASS;
- `node evals/harness.mjs`: OK, exit 0, and `--strict` exits 1 by design;
- my reference implementation: 54/54 MVP labels, v1.1 79/79;
- the reviewer's `mutate.mjs` and `imgmut.mjs`: no surviving mutation;
- existing `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test:e2e` were green on `910ed96`, and product code is unchanged since then.

### Re-review of `ec779c7`

The same reviewer re-reviewed the corrected revision `ec779c7e5b1581d8df3d3e78bc053c0248920711`, with the same read-only rules.

What it verified:
- All 22 earlier findings resolved, with evidence for each.
- Labels by its updated implementation: MVP 54/54; v1.1 79/79; image 80/10/58; content 14/14.
- Mutations: 39 of 39 classification mutations and all image mutations detected, including new ones for the last-non-empty segment, an exclusive 2048 limit, a dropped no-dimensions check, and aspect caps of 1.75, 1.79, and 2.0.
- Q5-O1 is still the only historical offer that changes under v1.1. No case was removed. The only label flips were the seven 2.0-to-1.8 aspect cases.
- MVP texts are carried verbatim. Nothing was weakened.

Verdict: **CHANGES REQUIRED, narrowly** (no blocking findings).

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| N1 | SHOULD-FIX | V9's comparison, from the fixture that defines the binding schema, also ends in leaked structure, and the malformed rule covered reasons only. | A scan of all 16 real comparisons found a second case: the accepted MVP run's Q4, displayed unedited (frozen as `R1-Q4-answer-bambino`). The owner chose "Cut and flag" on an AskUserQuestion card (D-042): text is cut before the first brace, citations are resolved on the kept text, and a note is shown, or the note alone when nothing readable remains. Frozen in EV-012 `comparisonCases` K01-K06 and the reason cases (P04 is now cut, not hidden; P06 adds a nothing-readable reason). EV-016 requires 0 displayed braces. REQ-002 amended. R-26 and V-F15 added. Labels come from a reference implementation of the citation rule that reproduces all 8 EV-004 cases. |
| N2 | SHOULD-FIX | The image minimums contradicted each other (8 images versus 6 cards). | One floor of 6 images in the JSON, REQ-008, and EVALUATION_PLAN, alongside the 70% rate. |
| N3 | SHOULD-FIX | The keySpecs cap of 5 was never exercised. | P06 candidate 0 now has six valid specs (expected list unchanged), and a new candidate has non-string items. |
| N4 | NIT | EV-014 check 6 could not run through the address policy. | Seam named: the exported `connectPinned(url, address)` below the policy; check 6 calls it, while checks 2 and 3 go through the policy. JM-103's criteria name it. |
| N5 | NIT | EV-007 staging in JM-104; the running state was not in EV-010's both-theme axe check. | JM-104: the EV-007 spec passes in its MVP form, with card amendments in JM-105. EV-010 check 7 adds the running state. |
| N6 | NIT | D-041 credited the 1.8 aspect limit to the reviewer; the probe script still showed 2.0. | D-041 now says it is the author's decision on probe evidence V-F14. The probe script has a comment saying the frozen rule is authoritative. |
