# Execution Plan

Status: proposed for approval with plan `kensaku-mvp-v1`.

## Completion condition

Done means all of the following, observed on GitHub and locally:

1. JM-001 to JM-006 are merged into `dev` through one PR each, with required checks green at the merged head.
2. On the final `dev` head, CI passes EV-001 to EV-007 and EV-009, plus typecheck, lint, build, harness, component integrity, and the Futari contract check.
3. EV-008 passes locally under its thresholds; the evidence (run log and owner audit) is committed in `.futari/evidence/live/` and summarized in `.futari/evidence/JM-006.md`.
4. The owner records product acceptance in `docs/futari/PROGRESS.md`.

Merge-ready is not merged. Merged into `dev` is not promoted: promotion to `main` and any deployment are outside this plan (D-021, D-023).

## Milestones and graph

```
JM-001 scaffold ──┬──▶ JM-002 core rules ─────┐
                  └──▶ JM-003 Exa adapter ────┴──▶ JM-004 vertical slice ──▶ JM-005 frontend ──▶ JM-006 live acceptance
```

- Milestone `vertical-slice`: JM-001, JM-002, JM-003, JM-004. JM-002 and JM-003 run in parallel (disjoint paths, no shared files). JM-004 waits for both to merge.
- Milestone `mvp`: JM-005, then JM-006, sequential.
- Expansion after the slice starts only when JM-004 is merged, its live smoke passed, and CI is green on `dev`.

## Task contracts

Full machine-readable contracts (allowed paths, acceptance, commands) are in `.futari/plan.json`. Summary:

| Task | Goal | REQ | EV | Depends | Key paths |
| --- | --- | --- | --- | --- | --- |
| JM-001 | pnpm/TypeScript/Vite/React/Tailwind/Hono scaffold; install all runtime and dev dependencies; shadcn init with `@ai-elements` registry; install the listed components; `components.lock.json` and `scripts/check-components.mjs`; Hono `/api/health` on 127.0.0.1; deterministic CI workflow. | REQ-010 | EV-007 | none | `package.json`, `pnpm-lock.yaml`, configs, `components.json`, `src/web/components/`, `src/web/lib/`, `src/server/index.ts`, `.github/workflows/ci.yml` |
| JM-002 | Pure rules in `src/core`: types, classification, identity, currency, ranking, citations, URL canonicalization, host lists. | REQ-002, REQ-003, REQ-004 | EV-001, EV-002, EV-003, EV-004 | JM-001 | `src/core/`, `tests/core/`, `tests/evals/ev-001..004` |
| JM-003 | `ExaPort`, `ExaSdkPort` (only `exa-js` importer), `FixtureExaPort`, `RequestBudget`, cache, ledger, error mapping. | REQ-006 | EV-005 | JM-001 | `src/exa/`, `tests/exa/`, `tests/evals/ev-005` |
| JM-004 | Pipeline, Hono `/api/chat` UI message stream, host/origin guard, minimal AI Elements UI rendering progress, comparison, offers, evidence; one live smoke run. | REQ-001, REQ-005, REQ-007 | EV-006, EV-009 | JM-002, JM-003 | `src/research/`, `src/server/`, `src/web/app/`, `src/web/main.tsx`, tests |
| JM-005 | Full UI: market selector, history persistence and clearing, all states, accessibility, layout, Playwright EV-007. | REQ-009, REQ-010 | EV-007 | JM-004 | `src/web/app/`, `src/web/main.tsx`, `tests/e2e/` |
| JM-006 | `pnpm live:acceptance`, run EV-008, owner audit, fixes limited to pipeline and UI, README. | REQ-008 | EV-008 | JM-005 | `scripts/live-acceptance.ts`, `.futari/evidence/live/`, `README.md`, `src/research/`, `src/web/app/` |

## Integration and shared files

- `package.json` and `pnpm-lock.yaml`: JM-001 installs every dependency named in `ARCHITECTURE.md`. JM-002 and JM-003 may not touch either file, which keeps the parallel pair conflict-free. JM-004, JM-005, and JM-006 run sequentially and may add scripts or dependencies.
- `.github/workflows/ci.yml`: owned by JM-001; later changes need a plan revision.
- `src/server/index.ts`: JM-001 creates the minimal server; JM-004 extends it (sequential).
- `src/web/components/ui/` and `src/web/components/ai-elements/`: written only by the shadcn CLI (JM-001, and JM-005 if it adds a component), never edited by hand; `components.lock.json` is updated in the same commit.
- Interfaces between JM-002/JM-003 and JM-004 are the types in `src/core/types.ts` and the `ExaPort` interface in `src/exa/port.ts`, both specified in `ARCHITECTURE.md`.
- Each task runs in its own worktree from current `dev`.

## Permissions and limits

- Repository: `futari-labs/kensaku`. Integration branch: `dev` (default). Task branches: `jm-00N-<slug>` from `dev`; PRs target `dev`.
- Allowed: create one issue per task, push task branches, open PRs into `dev`, merge into `dev` after required checks and independent review pass (D-022).
- Forbidden: any push, PR merge, or ruleset change on `main`; force pushes; changing repository settings; disabling or bypassing checks; deployment.
- Parallelism: at most 2 tasks at once (only JM-002 and JM-003 can overlap).
- Repair: at most 3 repair attempts per task; then stop and report.
- Live Exa use: only the JM-004 smoke run (≤ 5 requests) and EV-008 (≤ 30 requests per suite run, ≤ 3 runs); total ≤ 120 requests and ≤ $2.00 reported cost, from free credits only. Additional spend: $0. Stop on exhausted credits.
- Credentials: tasks read the key through `EXA_ENV_FILE=/Users/josiahwong/Documents/kensaku/.env.local` or the checkout's own ignored `.env.local`; never copy it into a tracked file.

## Definition of done

Per task: acceptance criteria met; listed verification commands pass at the tested commit; the evidence file has the required `Futari-Plan`, `Futari-Task`, `Tested-Commit`, and `Verdict` lines; an independent reviewer approved; CI green; merged into `dev`. For the MVP: the completion condition above, including the owner's acceptance.
