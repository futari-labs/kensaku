# Pstack Handoff

Status: proposed for approval with plan `kensaku-v1-2`. This file does not claim approval; `.futari/approval.json` records it.

## Approved target

- Plan ID: `kensaku-v1-2` (supersedes the completed `kensaku-v1-1`, archived in `docs/futari/archive/kensaku-v1-1/`; the MVP contract is in `docs/futari/archive/kensaku-mvp-v1/`).
- Repository: `futari-labs/kensaku`, private on the GitHub Free plan (`research/github-2026-11-21.md`). Default and integration branch: `dev`. The owner creates and promotes `main` personally; no agent touches it (D-021, D-023, D-025).
- Contract: `.futari/plan.json`, `docs/futari/*.md`, research notes in `docs/futari/research/` (v1.2: `stripe-2026-11-23.md`), frozen evaluation inputs in `evals/`.

## Installed capabilities

Observed 2026-11-23 on the planning machine, in the main checkout on branch `v1-2-plan`:

- Claude Code: `2.1.330`.
- pstack: `pstack@pstack-claude` `0.9.145`, install path `/Users/josiahwong/.claude/plugins/cache/pstack-claude/pstack/0.9.145`.
- Futari plugin: `futari@futarilabs` `1.0.2`.
- Relevant skills: `pstack:poteto-mode`, `pstack:tdd`, `pstack:architect`, `pstack:interrogate`, `pstack:thermos`, `pstack:babysit`, `pstack:swarm`.
- MCP servers: `shadcn` (project `.mcp.json`, pinned `shadcn@4.23.0`; component discovery and audit) and the Exa MCP (development research only, D-019). No Stripe MCP is used; the product uses only the `stripe` SDK (D-052).

## Compatibility evidence

Command (run from the Git root on branch `v1-2-plan` on 2026-11-23):

```
node /Users/josiahwong/.claude/plugins/cache/pstack-claude/pstack/0.9.145/skills/poteto-mode/scripts/check-playbooks.mjs
```

Output: `Every project playbook matches this pstack's playbooks.` Exit code `0`.

Prerequisites observed 2026-11-23:
- Node.js `v22.20.0`; pnpm `10.22.0`;
- `gh` authenticated as `d3F0g` with admin permission on `futari-labs/kensaku` (R-14);
- the Exa key in the untracked, ignored `/Users/josiahwong/Documents/kensaku/.env.local`;
- **not yet present:** the Stripe CLI (`stripe` is not installed) and the Stripe sandbox key and webhook secret. These are owner prerequisites for the JM-203 smoke (EXECUTION_PLAN "Owner prerequisites"), not for JM-201 and JM-202.

## Execution instructions

1. Start with `/futari:execute` from a checkout of `dev` that contains the v1.2 approval commit (after the owner merges the contract PR).
2. Run `node .futari/plan-gate.mjs verify` before dispatching any task and before each consequential mutation.
3. Invoke the real pstack skill and load `.agents/playbooks/futari-approved-plan.md`.
4. Start JM-201 and JM-202 in parallel. After both merge, run JM-203; before its sandbox smoke, confirm with the owner that the prerequisites are done. After JM-203 merges with a passing smoke, run JM-204, then JM-205.
5. Every worker brief carries:
   - the plan ID `kensaku-v1-2`, the task ID, and the REQ and EV IDs;
   - the allowed paths, dependencies, acceptance criteria, and verification commands;
   - the permissions below;
   - the credential rule (`EXA_ENV_FILE`; Stripe values only in `.env.local`; never print, copy, or commit them; tests build fake secrets at runtime);
   - the rule that frozen case files are loaded unchanged;
   - the rule that no test contacts Stripe, and that live Stripe calls happen only in the JM-203 smoke and EV-023 in the sandbox.
6. Models follow `.claude/pstack-models.md` (implementation: sonnet; review roles as listed there).

## Operational authority

- Allowed:
  - one GitHub issue per task;
  - push task branches `jm-20N-<slug>`;
  - open PRs into `dev`;
  - merge into `dev` after required checks and independent review pass (`mergePolicy: after-required-checks`);
  - (v1.2) Stripe sandbox API calls and Stripe CLI `listen` and `events resend` with the owner's sandbox credentials, during the JM-203 smoke and EV-023 only.
- Forbidden, with any credential including the owner's personal `gh` login:
  - creating, pushing to, merging into, or opening PRs against `main`;
  - `gh pr merge --auto`;
  - writes to branch, ruleset, protection, visibility, or settings endpoints;
  - force pushes;
  - bypassing or disabling checks;
  - deployment;
  - live Stripe keys, `--live`, Stripe account or Dashboard setting changes, and automating the Stripe-hosted page.

  GitHub enforces none of the Git rules on the current private Free-plan repository (R-13, R-14), so every worker brief must state these rules verbatim.
- Parallelism 2; repair limit 3 per task.
- Merging into `dev` is process-gated: confirm that the `CI` and `Futari contract` runs succeeded on the PR head SHA and that the branch is current with `dev`, then merge. Confirm CI on the new `dev` head before dependent work.
- Live Exa (D-051): the JM-203 smoke (≤ 5 requests) and EV-023 (≤ 25 requests, ≤ 2 runs); plan-wide ≤ 30 requests and ≤ $0.40, free credits, additional spend $0. Stop on exhausted credits or a 402.

## Contract publication (before execution)

The v1.2 contract changes protected files and replaces the approval, so its PR fails `Futari contract` by design (R-38, as R-25). The reviewed commit archives the v1.1 approval and removes the live one. The approval card states explicitly that approving replaces the `kensaku-v1-1` baseline (D-044). After the owner selects "Approve plan" on that card:

1. Bootstrap records the approval on branch `v1-2-plan` with `node .futari/plan-gate.mjs approve --by "<git user.name>"`. No `--replace` is needed, because no live approval exists in the reviewed commit. Bootstrap commits only `.futari/approval.json` and runs `verify`.
2. With the owner's authorization, bootstrap pushes `v1-2-plan` and opens a PR into `dev`. CI must be green.
3. The owner merges that PR personally with a merge commit (not squash or rebase), so `approval.planCommit` stays reachable from `dev`. Agents do not merge it.

## Resume and acceptance

- On resume, read `docs/futari/PROGRESS.md`, every `.futari/evidence/*.md`, and the actual GitHub issues, PRs, branches, and CI results, and reconcile before acting. Deduplicate issues by task ID in the title.
- Verify the approval with `node .futari/plan-gate.mjs verify`; on drift, stop.
- Final acceptance: build the REQ → task → EV → evidence table in `PROGRESS.md`, confirm the completion condition in `EXECUTION_PLAN.md`, and ask the owner for v1.2 product acceptance on the native card. Promotion to `main` is not part of execution.
