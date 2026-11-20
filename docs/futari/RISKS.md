# Risks

Status: proposed for approval with plan `kensaku-mvp-v1`.

## Risk register

| ID | Risk | Likelihood / impact | Mitigation | Evidence | Trigger | Residual |
| --- | --- | --- | --- | --- | --- | --- |
| R-1 | Too few merchant offers: Best Buy, Target, and some retailers expose no extractable price (spike L4). | Medium / Medium | Ask for 8 results per offer search; up to 3 candidates; such pages still appear as evidence. | Spike: 19/30 US results had price and currency; SG 5/5. | EV-008 below 4/6 queries with an offer. | Some products show only evidence. Accepted. |
| R-2 | Exa extracts a wrong price (sale vs list price, wrong variant). | Medium / High | Kensaku shows the exact value Exa returned, labeled last observed, with source link and retrieval time; never edits it. Owner audit in EV-008. | Spike L7: XM5 at $169.99-$278 on one day. | Owner audit finds a mismatched price. | Cannot be eliminated without a live merchant feed (out of scope). |
| R-3 | 6 live queries cannot prove a general accuracy rate. | High / Low | Treat EV-008 as a sanity gate; deterministic rules carry the guarantees; 40 live labeled results back EV-001/002. | Eval plan. | Not applicable. | Accepted by approving the plan. |
| R-4 | Free-plan behaviour at zero credits is unobserved; a payment method added later could enable overage. | Low / High | Owner confirmed no card (D-012); per-run cap; monthly request and $8 cost limits; stop on 402 or credit errors. | D-012, D-017. | Any billed charge or 402. | Low. Owner must not add a card without revisiting D-005. |
| R-5 | Exa API or SDK changes (`summary` schema, `/answer` `outputSchema`). | Low / High | Exa calls only in `ExaSdkPort`; versions pinned; fixtures pin the expected shape. | SDK 2.29.0 types. | Live smoke or EV-008 schema errors. | Plan revision trigger. |
| R-6 | Identity matching false negatives (colour codes such as `WH1000XM5PME`) and accepted variants (MX Master 3S for Business). | Medium / Low | Safe direction: false negatives hide offers rather than show wrong ones. Variants sharing an identifier are allowed and keep their own product name. | Cases L09, L35. | Owner finds common variants missing. | Accepted. |
| R-7 | The merchant/host consistency check is skipped for non-Latin merchant names, so a Japanese editorial page marked as a listing could pass. | Low / Medium | Aggregator and editorial host lists include major JP sites; identity and listing checks still apply. | Case L37. | EV-008 JP audit failure. | Low. |
| R-8 | Exa candidates can be odd or nonexistent ("WH-1000XM4Cs", spike A2). | Medium / Low | A candidate shows offers only if offer search plus identity matching finds direct merchant pages; otherwise "no offers". | Spike A2. | Not applicable. | The comparison text may still mention such a product, with its citations. |
| R-9 | AI Elements or shadcn component updates change markup or behaviour. | Low / Medium | Install once with the CLI; `components.lock.json` hashes; integrity check in CI. | D-018. | Integrity check fails. | Updating components is a deliberate change. |
| R-10 | Accessibility gaps inside unmodified components. | Low / Medium | axe checks on real states; if a component cannot pass without edits, escalate (revisit trigger). | D-018. | EV-007 axe failure attributable to a component. | Plan revision. |
| R-11 | Version drift: the observed versions (vite 8, typescript 7, ai 7) may not install together. | Medium / Low | JM-001 may choose the nearest working release and record it. | ARCHITECTURE dependencies. | JM-001 install or build fails. | Low. |
| R-12 | Repository bootstrap: the remote `futari-labs/kensaku` is empty; neither `dev` nor `main` exists; the local `init` branch has no commits; the main checkout holds older untracked copies of the planning files. | Certain / Medium | After approval only, bootstrap runs D-024 steps 1, 2, and 4 as narrowed by D-025 (create and push `dev`, make it the default, switch the main checkout with a backup). The owner creates `main` personally. | Git state 2026-11-21. | Not applicable. | `dev` resolved by the approved steps; `main` waits for the owner. |
| R-13 | **Enforcement gap: GitHub enforces nothing on `main` or `dev`.** The repository is private and the organization is on GitHub Free; rulesets and branch protection return 403 (`research/github-2026-11-21.md` G1-G4). Pushes, merges, force-pushes, and deletions on `main`, and merges into `dev` without green checks, are technically possible. | Certain / High | Process-only control (D-023, D-025): the plan, playbook, and every worker brief forbid pushing to, merging into, or enabling auto-merge into `main`, forbid `gh pr merge --auto`, and require the agent to verify green `CI` and `Futari contract` runs before merging into `dev`. Agents do not create `main`; the owner does. Closing the gap needs an owner decision: make the repository public or upgrade to a paid plan, then add a `main` ruleset with an empty bypass list. Agents never change visibility or settings. | `gh` output, 2026-11-21. | Any push or merge to `main` not made by the owner. | Open until the owner closes it. |
| R-14 | **Enforcement gap: agents act with the owner's admin credentials.** The `gh` token on the planning machine belongs to the owner (org admin, `repo` and `workflow` scopes). Agent actions are indistinguishable from the owner's on GitHub, and an admin token could edit or delete a future ruleset. Repository auto-merge is enabled (`allow_auto_merge: true`). | Certain / High | Same process controls as R-13. Owner options: a separate non-admin machine identity for agents; a Claude Code PreToolUse hook or deny list blocking pushes and merges to `main`, `--auto` merges, and settings writes; disabling repository auto-merge. None is applied by this plan, because each changes credentials, settings, or permissions that need the owner's own action. | `gh auth status`, `gh api` output, 2026-11-21. | Not applicable. | Open until the owner closes it. |

## Accepted limitations

- Prices and availability are last observed by Exa, with Kensaku's retrieval time; not real time.
- No currency conversion; cross-currency offers are only grouped.
- Merchant pages without an extractable price are evidence, not offers.
- History lives in one browser profile; clearing site data removes it.
- Comparison usefulness is judged by the owner, not by an automated metric.

## Blocking questions

None remain open in the plan. The merge policy (D-022), `main` control (D-023, D-025), and post-approval Git steps (D-024 as narrowed by D-025) are decided. R-13 and R-14 are accepted, explicitly flagged enforcement gaps whose closing actions belong to the owner. Which "Aria" was meant is non-blocking: the architecture does not depend on it.
