# Pstack Handoff

Status: proposed for approval with plan `kensaku-v1-1`. This file does not claim approval; `.futari/approval.json` records it.

## Approved target

- Plan ID: `kensaku-v1-1` (supersedes the completed `kensaku-mvp-v1`, archived in `docs/futari/archive/kensaku-mvp-v1/`).
- Repository: `futari-labs/kensaku`, private on the GitHub Free plan (`research/github-2026-11-21.md`). Default and integration branch: `dev`. The owner creates and promotes `main` personally; no agent touches it (D-021, D-023, D-025).
- Contract: `.futari/plan.json`, `docs/futari/*.md`, research notes in `docs/futari/research/`, frozen evaluation inputs in `evals/`.

## Installed capabilities

Observed 2026-11-21 on the planning machine, in the `v1-1-plan` worktree:

- Claude Code: `2.1.330`.
- pstack: `pstack@pstack-claude` `0.9.145` (user scope), install path `/Users/josiahwong/.claude/plugins/cache/pstack-claude/pstack/0.9.145`. An older cached `0.9.143` exists but is not the installed version.
- Futari plugin: `futari@futarilabs` `1.0.2`.
- Relevant skills: `pstack:poteto-mode`, `pstack:tdd`, `pstack:architect`, `pstack:interrogate`, `pstack:thermos`, `pstack:babysit`, `pstack:swarm`.
- MCP servers: `shadcn` (project `.mcp.json`, pinned `shadcn@4.23.0`; used for component discovery and audit) and the Exa MCP (development research only, never a runtime dependency, D-019).

## Compatibility evidence

Command (run from the Git root of the `v1-1-plan` worktree on 2026-11-21):

```
node /Users/josiahwong/.claude/plugins/cache/pstack-claude/pstack/0.9.145/skills/poteto-mode/scripts/check-playbooks.mjs
```

Output: `Every project playbook matches this pstack's playbooks.` Exit code `0`.

Prerequisites observed:
- git 2.40.1;
- Node.js `v22.20.0`;
- pnpm `10.22.0`;
- `gh` authenticated as `d3F0g` (scopes `gist`, `read:org`, `repo`, `workflow`) with admin permission on `futari-labs/kensaku` (R-14);
- the Exa key in the untracked, ignored `/Users/josiahwong/Documents/kensaku/.env.local`.

## Execution instructions

1. Start with `/futari:execute` from a checkout of `dev` that contains the v1.1 approval commit (after the owner merges the contract PR).
2. Run `node .futari/plan-gate.mjs verify` before dispatching any task and before each consequential mutation.
3. Invoke the real pstack skill and load `.agents/playbooks/futari-approved-plan.md`.
4. Start JM-101 and JM-102 in parallel. After JM-101 merges, run JM-103 (image proxy), then JM-104 (vertical slice gate, including the live smoke). JM-102 may overlap any one of these. After JM-102 and JM-104 are both merged, run JM-105, then JM-106.
5. Every worker brief carries:
   - the plan ID `kensaku-v1-1`, the task ID, and the REQ and EV IDs;
   - the allowed paths, dependencies, acceptance criteria, and verification commands;
   - the permissions below;
   - the credential rule (`EXA_ENV_FILE`, never copy the key);
   - the rule that frozen case files and fixtures are loaded unchanged.
6. Models follow `.claude/pstack-models.md` (implementation: sonnet; review roles as listed there).

## Operational authority

- Allowed:
  - one GitHub issue per task;
  - push task branches `jm-10N-<slug>`;
  - open PRs into `dev`;
  - merge into `dev` after required checks and independent review pass (`mergePolicy: after-required-checks`).
- Forbidden, with any credential including the owner's personal `gh` login:
  - creating, pushing to, merging into, or opening PRs against `main`;
  - `gh pr merge --auto`;
  - writes to branch, ruleset, protection, visibility, or settings endpoints;
  - force pushes;
  - bypassing or disabling checks;
  - deployment.

  GitHub enforces none of this on the current private Free-plan repository (R-13, R-14), so every worker brief must state these rules verbatim.
- Parallelism 2; repair limit 3 per task.
- Merging into `dev` is process-gated: confirm that the `CI` and `Futari contract` runs succeeded on the PR head SHA and that the branch is current with `dev`, then merge. Confirm CI on the new `dev` head before dependent work.
- Live Exa (D-034): the JM-104 smoke (Q3 and Q4, ≤ 10 requests) and EV-016 (≤ 40 requests per run, ≤ 3 runs). The plan-wide total of ≤ 130 requests and ≤ $1.50 reported cost governs, from free credits; additional spend $0. Stop on exhausted credits or a 402. Never run the MVP `pnpm live:acceptance`.

## Contract publication (before execution)

The v1.1 contract changes protected files and replaces the approval, so its PR fails `Futari contract` by design (R-25). The reviewed commit archives the MVP approval and removes the live one. The approval card states explicitly that approving replaces the `kensaku-mvp-v1` baseline, so that selection is the owner's decision to replace it (D-027, independent review finding 12). After the owner selects "Approve plan" on that card:

1. Bootstrap records the approval on branch `v1-1-plan` with `node .futari/plan-gate.mjs approve --by "<git user.name>"`. This needs no `--replace`, because no live approval exists in the reviewed commit. Bootstrap commits only `.futari/approval.json` and runs `verify`.
2. With the owner's authorization, bootstrap pushes `v1-1-plan` and opens a PR into `dev`. CI must be green.
3. The owner merges that PR personally with a merge commit (not squash or rebase), so `approval.planCommit` stays reachable from `dev`. Agents do not merge it.

## Resume and acceptance

- On resume, read `docs/futari/PROGRESS.md`, every `.futari/evidence/*.md`, and the actual GitHub issues, PRs, branches, and CI results, and reconcile before acting. Deduplicate issues by task ID in the title.
- Verify the approval with `node .futari/plan-gate.mjs verify`; on drift, stop.
- Final acceptance: build the REQ → task → EV → evidence table in `PROGRESS.md`, confirm the completion condition in `EXECUTION_PLAN.md`, and ask the owner for v1.1 product acceptance. Promotion to `main` is not part of execution.
