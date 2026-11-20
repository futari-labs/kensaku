# Evaluation Plan

Status: proposed for approval with plan `kensaku-mvp-v1`.

## Traceability

| Eval | Requirements | Cases / fixture | Command | Pass rule |
| --- | --- | --- | --- | --- |
| EV-001 Merchant authenticity | REQ-003 | `evals/cases/offer-classification.json` (54 cases: 40 live, 14 synthetic) | `pnpm vitest run tests/evals/ev-001-merchant-authenticity.test.ts` | Every case's outcome and category equal the label; for offers, currency, amount, canonical URL (when labeled), and availability (when labeled) equal the label. 54/54, and the test asserts that the number of evaluated cases equals the file's case count. |
| EV-002 Product relevance | REQ-003 | Same file: identity cases L21-L25, L35, Y06, Y07, plus every live case whose label is not `irrelevant-product` (must pass identity) | `pnpm vitest run tests/evals/ev-002-product-relevance.test.ts` | 100% of cases: `irrelevant-product` exactly when labeled. |
| EV-003 Currency and ranking | REQ-004 | `evals/cases/ranking-currency.json` (4 cases) plus property tests | `pnpm vitest run tests/evals/ev-003-ranking-currency.test.ts` | All 4 cases produce exactly the expected groups and order. A property test (1,000 generated offer lists, fixed seed) shows that no group mixes currencies, output is a permutation of the de-duplicated input, and results do not depend on input order except where the rule's "first received" applies. |
| EV-004 Citations | REQ-002 | `evals/cases/citations.json` (2 live, 4 synthetic) plus pipeline fixture runs | `pnpm vitest run tests/evals/ev-004-citations.test.ts` | All 6 cases match. In fixture pipeline runs every rendered source URL is in that run's citations, and every offer URL is in that run's search result URLs. |
| EV-005 Spend guard and cache | REQ-006 | `FixtureExaPort` scenarios with call counting | `pnpm vitest run tests/evals/ev-005-spend-guard.test.ts` | Unit level (JM-003): `RequestBudget` refuses a sixth token; cache hits consume no token and keep `retrievedAt`; monthly limits block before a call; a 402 or credit error sets `exhaustedAt` and blocks later calls. Run level (JM-004): a run never exceeds 5 Exa calls under any combination of 3 candidates, the retry, and errors; a normal question uses ≤ 3; a repeated question within the TTL uses 0 and shows the original `retrievedAt`; a second concurrent `POST /api/chat` gets 409. All assertions pass. |
| EV-006 Streaming and failure states | REQ-001, REQ-005 | Hono app with `FixtureExaPort` scenarios that succeed, return no candidates, return no offers, and fail with 401, 402, 429, 500, and timeout; plus a client abort | `pnpm vitest run tests/evals/ev-006-stream-failures.test.ts` | For each non-cancel scenario, the stream contains progress parts in stage order, exactly one terminal state, the expected `data-error.kind`, and `partial` set correctly. For the abort: the in-flight Exa call is aborted, no parts follow the abort, and a `cancelled` log line is written (the client's cancelled state is checked in EV-007). After every scenario, including the abort, the run lock is released and the next request succeeds. No fixture data appears when `KENSAKU_EXA_MODE=live` and Exa fails. All pass. |
| EV-007 Frontend quality | REQ-001, REQ-002, REQ-003, REQ-007, REQ-009, REQ-010 | Playwright against `pnpm start` in fixture mode | `pnpm test:e2e` and `node scripts/check-components.mjs` | See "Frontend quality" below. All automated checks pass; owner visual review recorded in evidence. |
| EV-008 Live acceptance | REQ-008 | `evals/cases/live-acceptance.json` (6 queries) | `pnpm live:acceptance` | See "CI and live checks". |
| EV-009 Local and key safety | REQ-007 | Server start tests; a build made by the test itself; logs, cache, fixtures | `pnpm vitest run tests/evals/ev-009-key-safety.test.ts` | The running server's listening address is 127.0.0.1; requests with a foreign `Host` or `Origin` get 403; the test runs a production build into a temporary directory with a test key in the environment and asserts the key string is absent from that build, from server logs of a fixture run, `.cache/`, `evals/fixtures/`, and API responses. (Browser storage is checked in EV-007.) |

## Fixtures and provenance

- `evals/fixtures/exa-live/*.json`: 12 real Exa responses captured 2026-11-21 by `spikes/exa/exa-spike.mjs` (stage 1: S1-S7, A1; stage 2: A2, S8, S9, A3). Each file has a `_label` saying it is a live response, plus the exact request, timestamps, and HTTP status. No credentials (checked by script after each run, and by the harness).
- Gold labels in `evals/cases/*.json` are **assistant-proposed** from the rules in `ARCHITECTURE.md`, with a rationale per case. They become gold only through the owner's plan approval; the approval packet lists every non-obvious label. They are labels for Kensaku's rules applied to Exa's extracted data, not independent truth about the live pages.
- Synthetic cases (Y01-Y14, R01-R04, C03-C06) are marked synthetic in their files. Y11-Y14 were added after the independent review (missing merchant, three-decimal price, rule precedence, a second merchant-mismatch case).
- Fixture scenarios for pipeline, stream, and e2e tests live in `tests/fixtures/scenarios/` (see ARCHITECTURE "Fixture scenarios"). Synthetic responses in them are labeled synthetic; they are test inputs, not gold labels.
- The live query set (Q1-Q6) is assistant-chosen to cover all three markets, specific and open-ended questions; owner approves it with the plan.
- Privacy: fixtures contain only public web data and the spike's own queries.

## Harness and baseline

`node evals/harness.mjs` validates the frozen cases and fixtures and reports each evaluation's state without running product code. Baseline on 2026-11-21:

```
HARNESS OK: 54 classification cases (40 live), 4 ranking cases, 6 citation cases, 6 live queries.
EV-001 .. EV-009: NOT RUNNABLE (product module does not exist)
```

States are kept distinct: **harness valid** (cases and fixtures are consistent), **not runnable** (product module or test file missing), **product assertion failing** (test runs and a case mismatches), **blocked** (an external dependency such as Exa or the browser runtime is unavailable). Only a run of the listed command can produce PASS or FAIL. An Exa outage during EV-008 is BLOCKED, not FAIL, and not PASS.

Tests that implement EV-001 to EV-006 and EV-009 must load the frozen case files directly and assert per case; they may not copy, filter, or edit cases. Once a test file exists, `node evals/harness.mjs` fails if it does not reference its frozen case file, and the case-driven tests assert that the number of evaluated cases equals the file's case count.

## AI quality

Kensaku uses no model of its own; Exa's `/answer` and summary extraction are external AI. Their quality is controlled by deterministic gates rather than an LLM judge:

- Extraction errors (wrong product, editorial pages, aggregator attribution, missing prices) are caught by the classification rules and measured by EV-001 and EV-002 on 40 live results.
- Comparison quality is not scored automatically. Citations are checked structurally (EV-004), and the owner judges usefulness in EV-008's audit and in final product acceptance. With 6 live queries the audit is a sanity check, not a statistical guarantee; RISKS R-3 records this.
- No AI judge is used, so there is no judge calibration.

## Failure coverage

- Boundaries: zero, fractional-yen, and non-ISO prices; unsupported currencies; non-http URLs; URLs not from the run; colour variants; near-miss model numbers; non-Latin merchant names; tracking parameters.
- Provider: 401, 402, 429 with `Retry-After`, 5xx, timeout, cancel, no candidates, no offers, out-of-range citation markers.
- Spend: per-run cap, monthly limits, exhausted credits, cache hits.
- Security: listening address is 127.0.0.1, foreign Host/Origin, key leakage into bundle, logs, cache, fixtures, or browser storage.
- Concurrency: a second simultaneous run is refused with 409, keeping one ledger writer (EV-005).

## Frontend quality

EV-007 automated checks (Playwright, Chromium, fixture mode):

1. Primary journey: submit Q1's text; progress shows the four stages in order; the comparison shows inline citations that link to the fixture's citation URLs; the offer table shows merchant host, price with currency code, availability badge, retrieved time, and link; evidence appears in a separate, labeled section; the "last observed" price notice is visible.
2. States: empty state with suggestions; running state with input disabled and a working cancel; no-offers state text; each `data-error` kind renders its specific message; partial results are labeled partial.
3. History: after a reload the conversation is restored; Clear history asks for confirmation and then empties the thread and removes `kensaku.history.v1`; corrupted stored data shows the reset notice.
4. Market: switching to SG or JP sends that market and orders that currency group first; the choice survives reload.
5. Accessibility: `@axe-core/playwright` reports zero serious or critical violations on the empty, running, completed, and error states; the whole journey works with the keyboard only; progress changes are announced through an ARIA live region.
6. Layout: at 375 px width there is no horizontal page scroll and the offer table remains readable (scrolls within its container).
7. Secrets (REQ-007): after the journey, no `localStorage` or `sessionStorage` value contains the test key.
8. Component integrity: `scripts/check-components.mjs` verifies that every file under `src/web/components/ui/` and `src/web/components/ai-elements/` matches the SHA-256 recorded in `components.lock.json` when the shadcn CLI installed it, and that `components.json` lists the `@ai-elements` registry.

Owner review (human, recorded in `.futari/evidence/JM-005.md`): visual polish and readability on desktop and mobile widths.

## CI and live checks

- Deterministic CI (`.github/workflows/ci.yml`, created by JM-001, no secrets, on pull requests to `dev` and on pushes to `dev`): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (vitest, including EV-001 to EV-006 and EV-009), `pnpm build`, `pnpm test:e2e` (EV-007 in fixture mode), `node evals/harness.mjs`, `node scripts/check-components.mjs`.
- Live checks never run in CI. They run locally with the owner's key:
  - Slice smoke (JM-004): Q1 and Q2, at most 10 requests in total.
  - EV-008 (JM-006): `pnpm live:acceptance` runs Q1-Q6 with a fresh cache, at most 5 requests each and 30 per suite run, at most 3 suite runs under the `runRules` in `live-acceptance.json` (rerun only after a recorded fix or a BLOCKED run; the last run decides). It writes `.futari/evidence/live/<timestamp>.json` with every request, response summary, displayed offer, and cost; every run log is committed.
  - Pass rule: at least 4 of 6 queries show at least one merchant offer; 100% of displayed offers pass revalidation (a self-consistency check against the recorded Exa responses); the owner audits every displayed offer with the rubric in `live-acceptance.json` and at least 90% pass; zero fabricated offers; no unexpected error runs; reported cost per suite run ≤ $0.40.
- Total live usage during execution: at most 120 Exa requests (planned maximum 10 + 3 × 30 = 100) and $2.00 of reported cost, all from free credits. Additional spend: $0 (`liveEvaluationBudget.maxSpend = 0`). If Exa reports exhausted credits, live checks stop and the task records BLOCKED.

## Frozen inputs

Added to `protectedFiles`: `evals/cases/offer-classification.json`, `evals/cases/ranking-currency.json`, `evals/cases/citations.json`, `evals/cases/live-acceptance.json`, `evals/harness.mjs`, all 12 `evals/fixtures/exa-live/*.json`, and the research notes `docs/futari/research/exa-2026-11-21.md` and `docs/futari/research/references-2026-11-21.md`. Test files written during execution are not frozen, but they must load these frozen inputs unchanged.
