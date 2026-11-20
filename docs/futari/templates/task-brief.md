# Worker kickoff

Replace all bracketed fields with observed values before dispatch. If the installed
pstack supplies `poteto-mode/worker.md`, the first line of the actual kickoff is:

```text
Read <actual-absolute-poteto-mode-directory>/worker.md before anything else.
```

Do not send an invented path. Follow the installed version's kickoff requirements.

## Goal and authority

- User goal: <the product outcome, in one sentence>
- Task: <JM-001 — approved title>
- Plan ID / approved revision or digest: <values from plan and approval>
- Repository and worktree: <actual absolute paths>
- Branch / base revision: <actual values>
- Issue / PR: <links, or not created yet>
- Owner: <one accountable worker>
- pstack skill path: <actual absolute poteto-mode SKILL.md path>

Read `.futari/plan.json`, `.futari/approval.json`, `CLAUDE.md`,
`.agents/playbooks/futari-approved-plan.md`, and the task's approved specification
sections. Run `node .futari/plan-gate.mjs verify` before starting and before mutations.
If it fails, stop affected work and report the reason. Never run `approve`.

## Approved task

- Requirement IDs and relevant sections: <exact mappings>
- Evaluation IDs and fixtures/rubrics: <exact mappings>
- `dependsOn`: <task IDs and evidence that each dependency is ready on this base>
- Acceptance criteria: <observable predicates from the approved task>
- `allowedPaths`: <exact repository-relative files or subtrees ending in `/`>
- Excluded/protected files: <approved snapshots, plan, approval, guards, eval contracts>
- Verification commands and expected results: <actual approved commands/thresholds>
- Required independent review: <reviewer role and conditions>
- Permissions: <issue/PR operations, merge policy, deployment boundaries>

## Completion and reporting

Use real execution evidence. Do not weaken thresholds, remove required cases, or
report unrun checks as passed. Keep changes inside `allowedPaths`; protected
artifacts are immutable. Escalate material requirement, architecture, evaluation,
or scope changes as a proposal. Do not silently implement them.

Remain responsible for this task/PR through fixes, review, CI, and merge readiness.
Merge or deploy only when the approved contract explicitly allows that action.
Do not edit another worker's branch or start a duplicate owner.

Return: tested head SHA; changed files; acceptance/evaluation evidence; command exit
statuses; independent review verdict and reviewed SHA; issue/PR links; blockers;
and the next action. Save evidence in `.futari/evidence/<TASK>.md` and ask the
coordinator to reconcile the shared progress ledger. A self-report is not proof.
