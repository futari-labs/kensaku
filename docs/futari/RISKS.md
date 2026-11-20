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
| R-12 | Repository bootstrap: the remote `futari-labs/kensaku` is empty; `dev` and protected `main` do not exist; the local `init` branch has no commits; the main checkout holds older untracked copies of the planning files. | Certain / Medium | Git operations listed in the approval packet run only after explicit owner approval (D-021). | Git state 2026-11-21. | Not applicable. | Resolved by the approved bootstrap Git steps. |
| R-13 | GitHub cannot enforce protection on `main`: `futari-labs` is an organization on the GitHub Free plan (observed with `gh api orgs/futari-labs`), and branch protection and rulesets are not available for private repositories on that plan. | Certain / Medium | The owner chooses in the approval step: upgrade the plan (a GitHub cost, outside the Exa $0 rule), or accept process-only protection (no agent pushes to or merges into `main`; `permissions` and the playbook forbid it; the owner alone promotes). Kensaku never makes the repository public to get protection. | `gh repo view` and `gh api` output, 2026-11-21. | Not applicable. | Depends on the owner's choice. |

## Accepted limitations

- Prices and availability are last observed by Exa, with Kensaku's retrieval time; not real time.
- No currency conversion; cross-currency offers are only grouped.
- Merchant pages without an extractable price are evidence, not offers.
- History lives in one browser profile; clearing site data removes it.
- Comparison usefulness is judged by the owner, not by an automated metric.

## Blocking questions

None remain open in the plan. Two items need the owner's choice before approval and are asked in the approval step: the merge policy into `dev`, and approval of the bootstrap Git operations. Which "Aria" was meant is non-blocking: the architecture does not depend on it.
