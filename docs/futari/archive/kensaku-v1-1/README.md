# Archived contract: kensaku-v1-1

This folder keeps the completed v1.1 contract for reference. It is not the active plan.

- `plan.json` is a byte-for-byte copy of `.futari/plan.json` as approved for plan `kensaku-v1-1` (revision CR-003).
- `approval.json` is a byte-for-byte copy of `.futari/approval.json`: approved by d3F0g on 2026-11-21T06:32:01Z at plan commit `47f813dc40f92fe41bbcdde8c83c2286c237f46a`, snapshot `f8ff98c5809ae36e99322d2ce9963e0f332cfb5b41d1f3b3fba57f93b78775f7`.
- v1.1 was executed in full (JM-101 to JM-106, one PR each) and accepted by the owner on 2026-11-22. See `docs/futari/PROGRESS.md` and `.futari/evidence/`.

The approved v1.1 documents are the versions of `docs/futari/*.md` at commit `47f813d`; read them with `git show 47f813d:docs/futari/PRODUCT_SPEC.md` (and so on). That commit stays reachable from `dev` because the contract PRs were merged with merge commits.

Plan `kensaku-v1-2` supersedes this contract (DECISIONS D-044). Its reviewed commit deletes the live `.futari/approval.json`, so the v1.2 approval is a new record, not an `approve --replace` of this one.
