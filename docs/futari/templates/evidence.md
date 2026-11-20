# <JM-001> verification evidence

Futari-Plan: <planId>
Futari-Task: <JM-001>
Tested-Commit: <full tested code commit SHA>
Verdict: <VERIFIED or NOT VERIFIED or INCONCLUSIVE>

- Plan ID / approved revision or digest: <exact values>
- Task / requirement IDs / evaluation IDs: <exact mappings>
- Repository / branch / PR: <values and links>
- Tested head SHA: <full SHA>
- Integration base SHA: <full SHA>
- Run time and environment: <ISO timestamp, runtime, relevant service/model versions>
- Overall verdict: <VERIFIED | NOT VERIFIED | INCONCLUSIVE>

## Commands and results

| Check | Command or CI run | Exit/result | Evidence artifact |
| --- | --- | --- | --- |
| Frozen approval | `node .futari/plan-gate.mjs verify` | <actual result> | <log/link> |
| Task checks | <approved command> | <exit code and result> | <log/link> |
| Regression | <approved command> | <exit code and result> | <log/link> |
| Product/eval | <approved command> | <exit code and result> | <report/link> |

## Acceptance and evaluation outcomes

| Requirement / eval | Approved acceptance or threshold | Observed outcome | Verdict |
| --- | --- | --- | --- |
| <REQ-001 / EV-001> | <predicate or threshold> | <measurement> | <verdict> |

Identify dataset/fixture version, evaluated case count, exclusions, sample/repeat
policy, model/configuration, and judge version when applicable. Distinguish mocked,
fixture, integration, and live-provider runs. Retain the approved statistical
method; do not treat one favorable probabilistic run as a deterministic guarantee.

## Independent review

- Reviewer and report: <identity/role and link>
- Reviewed head SHA: <full SHA>
- Verdict and material findings: <actual outcome>
- Fixes and re-review evidence: <links, or no changes required>

## Integrated behavior

<Observed user journey and real boundary checks. Include relevant before/after or
failing baseline proof. For a vertical slice, identify which slice gates it proves.>

## Limits and next action

<Missing credentials, unavailable services, unrun checks, residual risks, pending
product acceptance, and the next eligible action. Missing evidence is not a pass.>

Keep secrets and private raw data out of this record. Link safe, inspectable proof.
Record after-code-change checks against the new head rather than reusing stale evidence.
Commit tested code first. Add this evidence in a later evidence-only commit.
CI allows only this task's evidence and PROGRESS.md to differ after Tested-Commit.
Use the exact single marker lines above; CI requires VERIFIED before merge.
