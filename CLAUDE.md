
<!-- FUTARI_BOOTSTRAP_BEGIN -->
## FutariLabs engineering contract

@.claude/pstack-models.md

Start new projects with /futari:bootstrap. Before human approval, stay in interactive discovery, architecture, local evaluation-harness work, and design review. Do not implement product features or create GitHub issues/PRs.

The approved contract lives in .futari/plan.json and docs/futari/. The human approves through the native AskUserQuestion card; only after that explicit selection may /futari:bootstrap record and commit approval automatically. A new session, an assistant summary, or a passing readiness check is not approval.

Start or resume implementation with /futari:execute. Run node .futari/plan-gate.mjs verify before task dispatch and consequential mutations. Invoke the real pstack skill and load .agents/playbooks/futari-approved-plan.md. Carry plan/task/REQ/EV IDs, allowed paths, prerequisites, checks, and permissions into every worker brief.

Keep approved specs, evaluation inputs/thresholds, approval records, and controls unchanged during implementation. Escalate material changes as a reviewed plan revision. Never refresh hashes, bypass checks, fabricate evidence, or change repository protections to get a green result.

Use docs/futari/PROGRESS.md and .futari/evidence/<TASK>.md for observations and resume state. Merge only under the approved policy and actual repository rules; deployment is a separate future authorization.
<!-- FUTARI_BOOTSTRAP_END -->
