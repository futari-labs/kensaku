# Execution Plan

Status: proposed for approval with plan `kensaku-v1-1`. The MVP execution plan (JM-001 to JM-006) is complete; see `docs/futari/PROGRESS.md` and the archived contract.

## Completion condition

Done means all of the following, observed on GitHub and locally:

1. JM-101 to JM-105 are merged into `dev` through one PR each. The `CI` and `Futari contract` checks are green on each PR head, and CI is green on `dev` after each merge.
2. On the final `dev` head, CI passes EV-001 to EV-007, EV-009 to EV-015, and EV-017, plus typecheck, lint, build, harness, and the component check. `node evals/harness.mjs --strict` exits 0 locally.
3. EV-016 passes locally under its thresholds. Every run log and the owner's offer and image audits are committed in `.futari/evidence/live/` and summarized in `.futari/evidence/JM-105.md`.
4. The owner records v1.1 product acceptance in `docs/futari/PROGRESS.md`.

Merge-ready is not merged. Merged into `dev` is not promoted: promotion to `main` and any deployment are outside this plan (D-021, D-023, D-025).

## Milestones and graph

```
JM-101 core rules v1.1 ──▶ JM-103 vertical slice (live smoke) ──┐
JM-102 theme ────────────────────────────────────────────────────┴──▶ JM-104 product cards ──▶ JM-105 live acceptance
```

- Milestone `vertical-slice`: JM-101, then JM-103. JM-103 starts only after JM-101 is merged and `dev` CI is green.
- Milestone `experience`: JM-102 (runs in parallel with JM-101; disjoint paths), then JM-104, after both JM-102 and JM-103 are merged.
- Milestone `acceptance`: JM-105.
- Parallelism: JM-101 and JM-102 may run at the same time. Nothing else overlaps.
- Expansion past the slice (JM-104) starts only when JM-103 is merged, its live smoke has passed, and CI is green on `dev`.

## Task contracts

Full machine-readable contracts are in `.futari/plan.json`: allowed paths, acceptance criteria, and verification commands. Summary:

| Task | Goal | REQ | EV | Depends | Key paths |
| --- | --- | --- | --- | --- | --- |
| JM-101 | Classification rule additions 4, 5, 5a, 5b, 5c, 7; new evidence categories; image rules I1-I3 (pure); key specs and reason helpers; EV-001 applies the supersessions; harness `--strict` green. | REQ-003, REQ-004, REQ-012, REQ-013, REQ-016 | EV-001, EV-002, EV-003, EV-011, EV-012, EV-013 | none | `src/core/`, `src/web/app/format.ts` (labels only), `tests/core/`, EV-001/011/012/013 tests |
| JM-102 | Dark default, header toggle, `kensaku.theme.v1`, blocking `public/theme-init.js`, both-theme accessibility. No new components and no CSS variable changes. | REQ-011, REQ-010 | EV-010, EV-007 | none | `index.html`, `public/theme-init.js`, `src/web/app/theme.ts`, `ThemeToggle.tsx`, `App.tsx`, `main.tsx`, EV-010 and EV-007 specs |
| JM-103 | Market-aware offer query, extended `/answer` schema, image candidates in `data-products`, image proxy with registry, address policy, rule I3 and cache, CSP, minimal image, specs and reason in the existing product section; live smoke. | REQ-001, REQ-005, REQ-006, REQ-007, REQ-012, REQ-013, REQ-014, REQ-015 | EV-004, EV-005, EV-006, EV-009, EV-012, EV-013, EV-014, EV-017 | JM-101 | `src/exa/`, `src/research/`, `src/server/`, `src/core/` (integration fixes), `src/web/app/Products.tsx`, `schemas.ts`, `messages.ts`, `format.ts`, tests, `tests/fixtures/`, `.futari/evidence/live/` |
| JM-104 | Install `card`, `aspect-ratio`, `skeleton`, `item`; `ProductCard.tsx`; two-up grid; Other markets and Research details; image skeleton, fallback and caption; MVP history rendering; EV-015 and amended EV-007; owner visual review. | REQ-001, REQ-002, REQ-003, REQ-007, REQ-009, REQ-010, REQ-011, REQ-012, REQ-013, REQ-015 | EV-015, EV-007, EV-010 | JM-102, JM-103 | `src/web/`, `components.json`, `components.lock.json`, `scripts/check-components.mjs`, `package.json`, `pnpm-lock.yaml`, `tests/e2e/`, `tests/fixtures/`, `playwright.config.ts` |
| JM-105 | `pnpm live:acceptance:v1-1` (browser-driven), EV-016 runs, owner offer and image audits, fixes, README. | REQ-008, REQ-013, REQ-015, REQ-016 | EV-016, EV-011, EV-013, EV-015 | JM-104 | `scripts/live-acceptance-v1-1.ts`, `scripts/live/`, `src/research/`, `src/exa/`, `src/core/`, `src/server/`, `src/web/app/`, tests, `README.md`, `.futari/evidence/live/` |

## Integration and shared files

- `src/core/types.ts`: JM-101 owns the v1.1 type additions in ARCHITECTURE "Interfaces and data". JM-103 may adjust them only if integration requires it, keeping EV-001, EV-002, EV-003, and EV-011 to EV-013 green.
- `src/web/app/format.ts`: JM-101 adds the two evidence labels; JM-103 may touch it after JM-101 merges (sequential). JM-102 does not touch it.
- `src/web/app/App.tsx`: JM-102 changes only the header. JM-104 changes the layout afterwards (sequential).
- `package.json` and `pnpm-lock.yaml`: JM-101 and JM-102 must not change them, which keeps the parallel pair conflict-free. JM-103, JM-104, and JM-105 run sequentially and may change them; a `live:acceptance:v1-1` script is added by JM-105.
- `src/web/components/ui/` and `src/web/components/ai-elements/`: written only by the shadcn CLI in JM-104 and never edited by hand. `components.lock.json` is updated in the same commit.
- `.github/workflows/ci.yml`: unchanged. Its `pnpm test` and `pnpm test:e2e` pick up the new test files automatically.
- `tests/fixtures/`: JM-103 adds image-bearing scenarios and `tests/fixtures/images/`. JM-104 and JM-105 may add scenarios (sequential).
- Fixes in `src/core/` made by JM-103 or JM-105 must keep EV-001 to EV-004 and EV-011 to EV-013 passing on the frozen cases. A rule change that would need a different label is a plan revision.
- Live run logs under `.futari/evidence/live/` are committed at or before the commit named in the evidence file's `Tested-Commit` line.
- Each task runs in its own worktree from current `dev`.

## Permissions and limits

Unchanged from the MVP (D-035):

- Repository: `futari-labs/kensaku`. Integration branch: `dev` (default). Task branches: `jm-10N-<slug>` from `dev`; PRs target `dev`.
- Allowed: create one issue per task, push task branches, open PRs into `dev`, and merge into `dev` after required checks and independent review pass (D-022).
- "Required checks" are enforced by process (R-13). Before merging, the agent confirms with `gh pr checks` and `gh run list` that the `CI` and `Futari contract` workflows succeeded on the PR's current head SHA and that the PR is up to date with `dev`. When JM-101 and JM-102 merge one after the other, the second PR is updated from `dev` and its checks re-run before it merges. After every merge, the agent confirms that the push-triggered CI run on the new `dev` head succeeds before starting dependent work.
- Forbidden, with any credential including the owner's personal `gh` login:
  - creating, pushing to, force-pushing, deleting, or merging into `main`;
  - opening or merging a PR whose base is `main`;
  - `gh pr merge --auto` on any PR;
  - any `gh api` write to branch, ruleset, protection, or repository-settings endpoints;
  - changing visibility;
  - force pushes anywhere;
  - disabling or bypassing checks;
  - deployment.

  These are binding process rules (R-13, R-14). Any violation stops execution and is reported to the owner.
- Parallelism: at most 2 tasks at once (only JM-101 and JM-102 can overlap).
- Repair: at most 3 repair attempts per task; then stop and report.
- Live Exa use (D-034): only the JM-103 smoke (≤ 10 requests) and EV-016 (≤ 40 requests per run, ≤ 3 runs). Total ≤ 130 requests and ≤ $1.50 reported cost, from free credits only. Additional spend: $0. Stop on exhausted credits or a 402.
- Live image fetches: only through the image proxy during the JM-103 smoke and EV-016 runs, and only for image URLs those runs registered.
- Credentials: tasks read the key through `EXA_ENV_FILE=/Users/josiahwong/Documents/kensaku/.env.local` or the checkout's own ignored `.env.local`; never copy it into a tracked file.

## Definition of done

Per task:
- the acceptance criteria are met;
- the listed verification commands pass at the tested commit;
- the evidence file has the required `Futari-Plan: kensaku-v1-1`, `Futari-Task`, `Tested-Commit`, and `Verdict` lines;
- an independent reviewer approved;
- CI is green;
- the task is merged into `dev`.

For v1.1: the completion condition above, including the owner's acceptance.
