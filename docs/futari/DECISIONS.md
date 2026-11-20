# Decisions

Status: DRAFT - fill during /futari:bootstrap.

## Decision record

| ID | Date | Question | Decision | Rationale | Source |
| --- | --- | --- | --- | --- | --- |
| D-001 | 2026-11-21 | Who is the first release for? | Owner plus a small invite list. Private web app behind simple auth. | Keeps the MVP focused on research quality; no billing, public abuse handling, or scale work. | User selection (AskUserQuestion) |
| D-002 | 2026-11-21 | What source backs "verified merchant offers"? | A paid structured shopping/SERP API. | Many merchants, structured price/merchant/URL, per-call cost. More reliable than page scraping; broader than single-merchant affiliate APIs. | User selection (AskUserQuestion) |
| D-003 | 2026-11-21 | Primary MVP surface? | Chat-style web app: streams research progress and ends in a comparison with offer links. | Matches the research-assistant job; AI Elements fits. | User selection (AskUserQuestion) |
| D-004 | 2026-11-21 | Data providers? | Exa 3.0 is the sole provider for product research and merchant offers. Supersedes D-002's separate shopping API and the SerpApi/SearchApi.io spike. | User's later, more specific answer (Q "budget") overrides their Q1 text and the spike selection. | User free text (AskUserQuestion) |
| D-005 | 2026-11-21 | Live spend ceiling? | $0 additional spend. Only the owner's existing free Exa credits; paid overages prohibited. No paid API cost without owner approval. | Owner instruction. | User free text (AskUserQuestion) |
| D-006 | 2026-11-21 | Offer truthfulness rules | Prices/availability are last-observed, source-reported data, never guaranteed. Every offer carries source, merchant, currency, URL, retrieval timestamp. Never fabricate offers or claim verified stock. | Owner instruction; matches Exa's own "latest observed" wording. | User free text (AskUserQuestion) |
| D-007 | 2026-11-21 | Integration shape and testing | Exa behind a TypeScript adapter. Automated tests use deterministic, clearly labeled fixtures. Live Exa integration tests required before the live research functionality / MVP is declared complete. | Owner instruction. | User free text (AskUserQuestion) |
| D-008 | 2026-11-21 | Reasoning engine | Exa Agent/Answer API, on Exa credits. Kensaku code does deterministic normalization, validation and ranking of offers. No Anthropic/OpenAI usage in the product. | One vendor, $0 additional spend. | User selection (AskUserQuestion) |
| D-009 | 2026-11-21 | Pre-approval Exa spike | Allowed: <=20 live Exa requests, hard-capped in script, key in gitignored `.env.local`. Responses saved as labeled fixtures. | Confirms the product-result schema before freezing the contract. | User selection (AskUserQuestion) |
| D-010 | 2026-11-21 | Access control | MVP is local-only (localhost), no auth, no deployment. Narrows D-001: invite-list access becomes a later milestone. | Owner choice; removes auth and email provider from MVP. | User selection (AskUserQuestion) |
| D-011 | 2026-11-21 | How are merchant offers obtained, given that Exa Connect (Affiliate.com) is pay-as-you-go only? | Exa Auto search over the index's ecommerce listings, with a per-result `summary` JSON schema (price, currency, availability, merchant). Kensaku validates each offer deterministically and drops offers without a parseable price, a currency, or a URL. | Fits D-005 free credits (~$0.02 per query). Research: `docs/futari/research/exa-2026-11-21.md` F7-F9. Fill rate unverified until the spike. | User selection (AskUserQuestion) |
| D-012 | 2026-11-21 | How is the $0 spend rule enforced? | The owner's Exa account is on the Free plan with no payment method, so Exa cannot bill overages. Kensaku also enforces a hard per-research request cap and records each response's `costDollars`. | Defense in depth. Overage refusal behaviour is an assumption until observed. | User selection (AskUserQuestion) |
| D-013 | 2026-11-21 | Spike execution | The owner adds `EXA_API_KEY` to the gitignored `.env.local`. The spike script `spikes/exa/exa-spike.mjs` plans 8 requests, persists a counter, and refuses to exceed 20 total. | Implements D-009. | User selection (AskUserQuestion) |

## Revisit triggers

TBD: What evidence would justify a separately reviewed plan revision.
