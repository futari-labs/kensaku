# Execution Plan

Status: proposed for approval with plan `kensaku-v1-2`. The MVP (JM-001 to JM-006) and v1.1 (JM-101 to JM-106) execution plans are complete; see `docs/futari/PROGRESS.md` and the archived contracts. The approved v1.1 version of this file is at commit `47f813d`.

## Completion condition

Done means all of the following, observed on GitHub and locally:

1. JM-201 to JM-205 are merged into `dev` through one PR each. The `CI` and `Futari contract` checks are green on each PR head, and CI is green on `dev` after each merge.
2. On the final `dev` head:
   - CI passes EV-001 to EV-007, EV-009 to EV-015, and EV-017 to EV-022, plus typecheck, lint, build, `node evals/harness.mjs`, and the component check.
   - `node evals/harness.mjs --strict --final` exits 0 locally at that head. CI runs the harness without `--strict`, and `ci.yml` stays unchanged.
3. The JM-203 sandbox smoke passed, and EV-023 passes locally under `evals/cases/live-acceptance-v1-2.json`. Every run log and the owner's H1-H5 audit are committed in `.futari/evidence/live/` and summarized in `.futari/evidence/JM-205.md`.
4. The owner records v1.2 product acceptance in `docs/futari/PROGRESS.md`.

Merge-ready is not merged. Merged into `dev` is not promoted: promotion to `main`, deployment, and live Stripe keys are outside this plan (D-021, D-023, D-025, D-050).

## Owner prerequisites

Needed before the JM-203 sandbox smoke (JM-201 and JM-202 need none of these). The owner does these personally; agents never handle account settings:

1. A Stripe account with a **sandbox** (Dashboard → sandboxes). Live mode is never used.
2. If the Stripe CLI requires it, enable CLI access for the sandbox (Settings → Team and security → MCP and CLI access; research S54).
3. Install the Stripe CLI (`brew install stripe`, or Stripe's install script) and run `stripe login`, choosing the sandbox, not live access.
4. Create a sandbox secret key, or a restricted key with Checkout Sessions read and write (research S51; if inline prices need more permissions, the smoke reports it, R-27), and put it in `/Users/josiahwong/Documents/kensaku/.env.local` as `STRIPE_SECRET_KEY=`.
5. Run `stripe listen --print-secret` once and put the value in the same file as `STRIPE_WEBHOOK_SECRET=`.
6. Be available for about 10 minutes in JM-203 (one USD test payment and one declined card) and about 20 minutes per EV-023 run (scenarios A1-A5) to use the Stripe-hosted page with the listed test cards.

Agents may then run `stripe listen`, `stripe events resend`, and SDK calls against that sandbox with the owner's CLI login and key (D-049). They never print, copy, or commit the key or secret.

## Milestones and graph

```
JM-201 commerce core rules ──┐
                             ├──▶ JM-203 slice (registry, store, routes, webhook, minimal UI, sandbox smoke) ──▶ JM-204 commerce UI ──▶ JM-205 live acceptance
JM-202 Stripe adapter ───────┘
```

- Milestone `vertical-slice`: JM-201 and JM-202 in parallel, then JM-203. JM-203 starts only after both are merged and `dev` CI is green.
- Milestone `experience`: JM-204, after JM-203 is merged and its sandbox smoke passed.
- Milestone `acceptance`: JM-205.
- Parallelism: JM-201 writes only `src/core/commerce.ts`, `src/core/index.ts`, `src/core/types.ts` (optional `Offer.id`), and its tests; JM-202 owns `package.json`, the lockfile, `src/commerce/` port files, and `src/server/config.ts`. Their scopes are disjoint, so they may run together (at most 2 tasks at once). Later tasks are sequential.
- Expansion past the slice (JM-204) starts only when JM-203 is merged, its sandbox smoke passed, and CI is green on `dev`. A Stripe-fact failure in the smoke (R-27, R-28) stops execution for a plan revision (D-056).

## Task contracts

Full machine-readable contracts are in `.futari/plan.json`: allowed paths, acceptance criteria, and verification commands. Summary:

| Task | Goal | REQ | EV | Depends | Key paths |
| --- | --- | --- | --- | --- | --- |
| JM-201 | Pure commerce rules: `offerId`, `toMinorUnits`, `applyCartOp`, `applyStripeEvent`, label strings; optional `Offer.id`. | REQ-017, REQ-018 | EV-018 | none | `src/core/commerce.ts`, `src/core/index.ts`, `src/core/types.ts`, `tests/core/commerce.test.ts`, EV-018 test |
| JM-202 | `stripe@23.1.0`; `CheckoutPort`, `StripeCheckoutPort`, `FakeCheckoutPort`, `verifyWebhook`; `buildCheckoutSessionRequest`; sandbox-only config. | REQ-019, REQ-023, REQ-018, REQ-022 | EV-019, EV-021 (checks 1, 2, 4) | none | `package.json`, `pnpm-lock.yaml`, `src/commerce/{port,stripe-port,fake-port,session-request}.ts`, `src/server/config.ts`, `.env.example`, tests |
| JM-203 | Offer registration in the pipeline; store; cart, checkout, order, cancel, and webhook routes; fake hosted page; minimal UI with the shadcn `sheet`; EV-021 checks 3 and 5; sandbox smoke. | REQ-017, REQ-019, REQ-020, REQ-021, REQ-023, REQ-007, REQ-001, REQ-005, REQ-006 | EV-018, EV-019, EV-020, EV-021, EV-005, EV-006, EV-009, EV-017 | JM-201, JM-202 | `src/commerce/`, `src/server/`, `src/research/pipeline.ts`, `events.ts`, `src/web/app/`, `sheet.tsx`, `.gitignore`, tests, `scripts/live-sandbox-smoke-v1-2.ts`, `.futari/evidence/live/` |
| JM-204 | Full commerce UI and all states; accessibility in both themes; EV-022; owner visual review. | REQ-024, REQ-017, REQ-018, REQ-021, REQ-022, REQ-009, REQ-010, REQ-007, REQ-002, REQ-003, REQ-011, REQ-012, REQ-013, REQ-015 | EV-022, EV-007, EV-010, EV-015 | JM-203 | `src/web/`, `src/commerce/fake-hosted.ts`, `tests/e2e/`, `tests/fixtures/`, `components.*`, `package.json`, lockfile, `playwright.config.ts` |
| JM-205 | `pnpm live:acceptance:v1-2`, EV-023 runs with the owner, README setup, full regression, fixes. | REQ-008 plus REQ-001 to REQ-007, REQ-011 to REQ-016, REQ-019 to REQ-023 | EV-023 and every carried deterministic EV | JM-204 | `scripts/live-acceptance-v1-2.ts`, `scripts/live/`, `package.json`, `README.md`, `src/commerce/`, `src/server/`, `src/web/app/`, `src/core/commerce.ts`, `tests/`, `.futari/evidence/live/` |

## Integration and shared files

- `src/core/types.ts`: JM-201 adds only the optional `Offer.id`. Nobody else changes it in this plan.
- `src/core/commerce.ts`: JM-201 owns it; JM-203 and JM-205 may fix it only if EV-018 and EV-020 stay green on the frozen cases. A change that needs a different label is a plan revision.
- `src/commerce/`: JM-202 creates the port files; JM-203 adds the rest and may adjust the port files; JM-204 may change only `fake-hosted.ts`; JM-205 may fix any file. Sequential after JM-202.
- `src/server/config.ts`: JM-202, which adds an optional `ServerConfig.stripe` and leaves `AppConfig` unchanged, so `tests/server/helpers.ts` and `tests/server/images/helpers.ts` still compile. `src/server/app.ts` and route files: JM-203 (commerce as an optional `createApp` dependency; `/api/health` unchanged, so `tests/smoke/server.test.ts` and `tests/e2e/slice.spec.ts` stay green), then JM-205 fixes.
- `src/research/pipeline.ts` and `events.ts`: JM-203 only (offer ids and registration). EV-005, EV-006, and EV-017 must stay green.
- `src/web/app/`: JM-203 adds the minimal UI; JM-204 completes it; JM-205 fixes. Sequential.
- `tests/evals/ev-021-stripe-keys.test.ts`: JM-202 writes checks 1, 2, 4; JM-203 adds 3 and 5. Sequential.
- `tests/e2e/ev-007-frontend.spec.ts` and `ev-015-product-cards.spec.ts`: carried assertions may not be weakened or deleted; tasks may add assertions (R-37).
- `package.json` and `pnpm-lock.yaml`: JM-202 (stripe), then JM-203 or JM-204 if the shadcn CLI adds a package for `sheet`, then JM-205 (the `live:acceptance:v1-2` script). JM-201 must not change them.
- `src/web/components/ui/`: written only by the shadcn CLI (JM-203 installs `sheet`), never by hand; `components.lock.json` updated in the same commit.
- `.github/workflows/ci.yml` and `eslint.config.js`: unchanged.
- Live run logs under `.futari/evidence/live/` are committed at or before the commit named in the evidence file's `Tested-Commit` line.
- Each task runs in its own worktree from current `dev`.

## Permissions and limits

Unchanged from v1.1 (D-035, D-051):

- Repository: `futari-labs/kensaku`. Integration branch: `dev` (default). Task branches: `jm-20N-<slug>` from `dev`; PRs target `dev`.
- Allowed: create one issue per task, push task branches, open PRs into `dev`, and merge into `dev` after required checks and independent review pass (D-022).
- "Required checks" are enforced by process (R-13). Before merging, the agent confirms with `gh pr checks` and `gh run list` that the `CI` and `Futari contract` workflows succeeded on the PR's current head SHA and that the PR is up to date with `dev`. When two parallel PRs merge one after the other, the second is updated from `dev` and its checks re-run before it merges. After every merge, the agent confirms that the push-triggered CI run on the new `dev` head succeeds before starting dependent work.
- Forbidden, with any credential including the owner's personal `gh` login:
  - creating, pushing to, force-pushing, deleting, or merging into `main`;
  - opening or merging a PR whose base is `main`;
  - `gh pr merge --auto` on any PR;
  - any `gh api` write to branch, ruleset, protection, or repository-settings endpoints;
  - changing visibility;
  - force pushes anywhere;
  - disabling or bypassing checks;
  - deployment;
  - (v1.2) using a live Stripe key, `stripe ... --live`, or changing Stripe account settings; automating the Stripe-hosted page.

  These are binding process rules (R-13, R-14). Any violation stops execution and is reported to the owner.
- Parallelism: at most 2 tasks at once (JM-201 beside JM-202).
- Repair: at most 3 repair attempts per task; then stop and report.
- The JM-203 smoke and EV-023 run against `http://127.0.0.1:8787` under `pnpm start` (R-40).
- Live Exa (D-051): only the JM-203 smoke (Q1 once, ≤ 5 requests) and EV-023 (≤ 25 requests across at most 2 runs). Plan-wide ≤ 30 requests and ≤ $0.40 reported cost, from free credits; additional spend $0. Stop on exhausted credits or a 402. Never run `pnpm live:acceptance:v1-1` or the MVP suite.
- Live Stripe (D-049, D-050): sandbox only, $0. Only the JM-203 smoke and EV-023. Agents create, retrieve, and expire sessions and resend events; the owner performs every hosted-page step.
- Credentials: tasks read keys through `EXA_ENV_FILE=/Users/josiahwong/Documents/kensaku/.env.local` or the checkout's own ignored `.env.local`; never copy them into a tracked file, log, or evidence.

## Definition of done

Per task:
- the acceptance criteria are met;
- the listed verification commands pass at the tested commit (for JM-205, `pnpm live:acceptance:v1-2` means the EV-023 run with the owner);
- the evidence file has the required `Futari-Plan: kensaku-v1-2`, `Futari-Task`, `Tested-Commit`, and `Verdict` lines;
- an independent reviewer approved;
- CI is green;
- the task is merged into `dev`.

For v1.2: the completion condition above, including the owner's acceptance.
