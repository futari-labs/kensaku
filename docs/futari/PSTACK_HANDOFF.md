# Pstack Handoff

Status: proposed for approval with plan `kensaku-mvp-v1`. This file does not claim approval; `.futari/approval.json` records it.

## Approved target

- Plan ID: `kensaku-mvp-v1`
- Repository: `futari-labs/kensaku` (private). Default and integration branch: `dev`. `main` is promoted only by the owner (D-021, D-023).
- Contract: `.futari/plan.json`, `docs/futari/*.md`, research notes in `docs/futari/research/`, frozen evaluation inputs in `evals/`.

## Installed capabilities

Observed 2026-11-21 on the planning machine:

- Claude Code: `2.1.329`
- pstack: `pstack@pstack-claude` `0.9.145` (user scope), install path `/Users/josiahwong/.claude/plugins/cache/pstack-claude/pstack/0.9.145`, git `ce7df681bda9568801bd1de77d5c5ea34442cc44`. An older cached `0.9.143` exists but is not the installed version.
- Relevant skills discovered: `pstack:poteto-mode`, `pstack:tdd`, `pstack:architect`, `pstack:interrogate`, `pstack:thermos`, `pstack:babysit`, `pstack:swarm`.
- Futari plugin: `futari` `1.0.2`.
- MCP servers: `shadcn` (project `.mcp.json`; needs `components.json`, created by JM-001) and the Exa MCP (`plugin:exa:exa`, development research only, never a runtime dependency, D-019).

## Compatibility evidence

Command (run from the Git root):

```
node /Users/josiahwong/.claude/plugins/cache/pstack-claude/pstack/0.9.145/skills/poteto-mode/scripts/check-playbooks.mjs
```

Output: `Every project playbook matches this pstack's playbooks.` Exit code `0`. First run in the main checkout; run again on 2026-11-21 in the `bootstrap-resume` worktree with the same output.

Prerequisites observed: git 2.40.1, Node.js `v22.20.0`, pnpm `10.22.0`, `gh` authenticated as `d3F0g` with ADMIN permission on `futari-labs/kensaku`. The organization is on the GitHub Free plan (R-13). The Exa key lives in the untracked, ignored `/Users/josiahwong/Documents/kensaku/.env.local`.

## Execution instructions

1. Start with `/futari:execute` from a checkout of `dev` that contains the approval commit.
2. Run `node .futari/plan-gate.mjs verify` before dispatching any task and before each consequential mutation.
3. Invoke the real pstack skill and load `.agents/playbooks/futari-approved-plan.md`.
4. Start JM-001. After it merges, run JM-002 and JM-003 in parallel. Then JM-004 (vertical slice gate, including the live smoke). Then JM-005 and JM-006 in order.
5. Every worker brief carries: plan ID, task ID, REQ and EV IDs, allowed paths, dependencies, acceptance criteria, verification commands, the permissions below, and the credential rule (`EXA_ENV_FILE`, never copy the key).
6. Models follow `.claude/pstack-models.md` (implementation: sonnet; review roles as listed there).

## Operational authority

- Allowed: one GitHub issue per task; push task branches `jm-00N-<slug>`; open PRs into `dev`; merge into `dev` after required checks and independent review pass (`mergePolicy: after-required-checks`).
- Forbidden: pushing to, merging into, or changing rules on `main`; force pushes; repository setting changes; bypassing or disabling checks; deployment.
- Parallelism 2; repair limit 3 per task.
- Live Exa: JM-004 smoke (≤ 5 requests) and EV-008 (≤ 30 requests per run, ≤ 3 runs); total ≤ 120 requests and ≤ $2.00 reported cost from free credits; additional spend $0; stop on exhausted credits or a 402.

## Resume and acceptance

- On resume, read `docs/futari/PROGRESS.md`, every `.futari/evidence/*.md`, and the actual GitHub issues, PRs, branches, and CI results; reconcile before acting. Deduplicate issues by task ID in the title.
- Verify the approval with `node .futari/plan-gate.mjs verify`; on drift, stop.
- Final acceptance: build the REQ → task → EV → evidence table in `PROGRESS.md`, confirm the completion condition in `EXECUTION_PLAN.md`, and ask the owner for product acceptance. Promotion to `main` is not part of execution.
