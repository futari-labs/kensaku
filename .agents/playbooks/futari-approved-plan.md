---
extends: ""
when: Execute or resume an approved FutariLabs plan through /futari:execute.
---

# Execute the approved FutariLabs plan

This standalone project playbook supplies the boundaries for pstack execution.
The approved `.futari/plan.json` and its frozen files define scope, dependencies,
evaluations, permissions, and completion. Apply pstack's real implementation,
verification, review, and shipping workflows inside these boundaries.

## 1. Verify the handoff

1. Run `node .futari/plan-gate.mjs verify` from the repository root. Stop execution
   if it fails. `check` only checks readiness; it does not authorize execution.
2. Read `.futari/plan.json`, `.futari/approval.json`, and the protected documents in
   `docs/futari/`: `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `EVALUATION_PLAN.md`,
   `EXECUTION_PLAN.md`, `DECISIONS.md`, `RISKS.md`, and `PSTACK_HANDOFF.md`.
3. Confirm that approval covers this repository, plan revision, and permissions.
   Never manufacture approval, run `approve` for the user, or regenerate approval
   to make a changed plan pass. A new chat or invocation does not approve drift.
4. Inspect the installed pstack version and actual available skills and files.
   Run its `skills/poteto-mode/scripts/check-playbooks.mjs` from this repository
   using the actual installed path. If missing or incompatible, report the exact
   gap and stop the pstack handoff; do not claim an improvised workflow is pstack.
5. Invoke real `pstack:poteto-mode` if it is not already active. Record the loaded
   playbook/skills and plugin version in `docs/futari/PROGRESS.md`. Do not assume an
   Orchestrate playbook or a `check-plan.mjs` script exists.

## 2. Reconstruct current state

1. Read `docs/futari/PROGRESS.md` and `.futari/evidence/`. Reconcile them with actual
   branches, worktrees, commits, issues, PRs, reviews, and CI results.
2. Reuse completed work whose evidence remains valid. Identify active owners before
   starting agents. Do not duplicate live workers or overwrite their changes.
3. Mark each task pending, active, blocked, verified, merge-ready, or merged using
   observed evidence. Passing CI alone does not establish product acceptance.
4. Pick an eligible task from the approved graph. Its `dependsOn` conditions must
   be satisfied on the branch it will use. A merge-ready dependency is not merged.
   Use stacked branches only when the approved execution plan allows them.

## 3. Establish traceable issues

1. Re-run `verify` before task dispatch and each repository, issue, PR, or merge
   mutation. Respect the approved permissions even when a tool would allow more.
2. Before creating an issue, search open and closed issues for both exact body
   markers, replacing the examples with the approved values:

   ```text
   Futari-Plan: <planId>
   Futari-Task: JM-001
   ```

3. Reuse the uniquely matching issue. Investigate multiple matches; do not create
   another. A task title or similar feature name alone is not a unique match.
4. Each task issue includes the goal, requirement/evaluation IDs, dependencies,
   acceptance criteria, exact `allowedPaths`, checks, and relevant approved docs.
   Keep one approved task per PR and link the issue. Do not create extra product
   scope. Record newly discovered needs as proposals for a later plan revision.

## 4. Prove the first vertical slice

1. Complete the tasks named by `verticalSliceTaskIds` and their prerequisites in
   dependency order before expanding implementation in parallel.
2. Prove a thin user journey across the real integration boundaries. Exercise the
   actual application and relevant provider path, with the approved test data and
   evaluation thresholds; fixtures alone cannot prove a required live integration.
3. Capture failing baseline evidence where meaningful, then the working result.
   Run independent review on the tested revision and resolve material findings.
4. Do not mark the slice passed while required credentials, services, evaluators,
   or independent review are unavailable. Report NOT VERIFIED or INCONCLUSIVE
   with the specific blocker. Continue only work independent of the failed gate.

## 5. Implement and verify each eligible task

1. Carry forward the approved framing and design. For a large run, use the
   installed `figure-it-out` skill as the execution method if appropriate, with
   its framing/design satisfied by the approved artifacts. Do not redo settled
   architecture or silently change requirements.
2. Give each task one owner responsible through implementation, review, CI, and
   merge readiness. Use separate worktrees for simultaneous independent writes.
   Respect the approved concurrency limit and avoid overlapping `allowedPaths`.
3. Give every worker a complete brief using the task-brief template. If current
   pstack supplies `poteto-mode/worker.md`, its kickoff's first line must point to
   that real absolute path as required by pstack. Include the actual poteto-mode
   skill path, task ID, plan revision/digest, constraints, and checks after it.
4. `allowedPaths` are exact repository-relative files or subtrees ending in `/`.
   They are not shell globs. Touch only the task's approved scope; protected
   artifacts remain immutable even if a broad subtree would otherwise include them.
5. Run the task's real checks and relevant regression/evaluation gates. Never lower
   thresholds, delete difficult cases, skip required tests, substitute fabricated
   outputs, or label an unrun check passed. Correct a defective evaluation through
   a separately approved plan change when its approved contract must change.
6. Review the diff and actual evidence. Use an independent reviewer for required
   review; the author, CI, and test results do not replace that verdict. Tie review
   and evidence to the final tested head SHA and repeat affected checks after edits.
7. Record evidence in `.futari/evidence/<TASK>.md` and update
   `docs/futari/PROGRESS.md`. Keep plan and approval snapshots frozen. For a material
   design/scope/evaluation change, stop affected work and present a concrete change
   proposal with consequences. Continue unrelated approved work when possible.

## 6. Finish the PR and integrate

1. Use the PR template with the exact plan/task markers, issue link, requirement
   and evaluation mappings, review verdict, and evidence links. Verify approval
   again immediately before creating/updating the PR or merging it.
2. Require the plan/task/scope CI check and all approved product checks. The plan
   guard must validate against the trusted base's protected snapshot and checker.
   Never edit or bypass that guard to get a green result.
3. Resolve relevant review findings, conflicts, and CI failures within scope. Keep
   the same task/PR owner until complete; stop an abandoned worker before replacement.
4. Merge only when `permissions.mergePolicy` is `after-required-checks`, all stated
   gates are satisfied, and repository rules allow it. Otherwise leave a verified,
   merge-ready PR. Never bypass required reviews, branch protection, or merge queues.
5. No deployment is authorized by default. Follow only explicit approved deployment
   permissions. Do not change repository protections or expand credentials.
6. After integration, verify the combined system as the plan requires. An isolated
   branch passing does not prove the integrated milestone works.

## 7. Report and resume

1. Report each requirement against its acceptance/evaluation evidence and exact
   revision. Distinguish verified, blocked, inconclusive, and pending work.
2. Record current task owners, issue/PR/worktree links, remaining dependencies,
   material findings, and the next eligible task in `docs/futari/PROGRESS.md`.
3. On session interruption or restart, `/futari:execute` begins again at verification
   and reconciliation. Preserve the approved plan and resume from observed state.
4. Claim project completion only when the original goal and all approved acceptance
   gates are met on the required artifact. Report what still needs the user's
   product acceptance without presenting it as already granted.
