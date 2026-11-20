# Product Spec

Status: DRAFT - in discovery. Not approved. Items marked **ASSUMPTION** need owner confirmation.

## Users and problem

Kensaku is a personal shopping research assistant. The first user is the owner (D-001, narrowed by D-010 to local use).

The owner wants to ask a buying question in plain language, such as "best noise-cancelling headphones for flights under $400". Today this means reading reviews, comparing specs, and checking several stores by hand. Kensaku does the research, compares a few candidates, and lists where each can be bought, with last-observed prices and links.

First valuable outcome: one question produces a short, cited comparison of 2-3 products and a list of merchant offers that each link to the merchant page.

## MVP and non-goals

Included:

- Local web app on `127.0.0.1`, no auth (D-010).
- Chat-style surface that streams research progress and ends in a comparison with offer links (D-003).
- Exa is the only data and reasoning provider (D-004, D-008). Offers come from Exa search plus per-result schema extraction (D-011).
- Every offer is source-reported and last-observed, with source, merchant, currency, URL, and retrieval timestamp (D-006).
- Zero additional spend. Free Exa credits only, with a per-research request cap (D-005, D-012).

Non-goals for the MVP:

- Deployment, hosting, auth, invite list, multiple users (later milestone per D-001).
- Checkout, carts, affiliate links, price alerts, price history.
- Currency conversion between offers.
- Guaranteed or real-time stock or price. Kensaku never claims verified stock.
- Any LLM provider other than Exa (D-008).
- **ASSUMPTION A-1:** US region, USD-first. Offers in other currencies are shown but not converted.
- **ASSUMPTION A-2:** No persisted chat history. A page reload clears the conversation.

## User journeys and UI states

Primary flow:

1. The owner opens `http://127.0.0.1:<port>` and types a question.
2. The run shows ordered progress stages: finding candidates, gathering offers, writing the comparison.
3. The result shows a cited comparison, then an offer table per product: merchant, price and currency, availability, retrieved-at time, and a link.
4. A notice states that prices and availability are last observed and must be confirmed on the merchant page.

States:

- Empty: a prompt with example questions.
- Running: stage list with the current stage marked; input disabled; cancel available.
- Partial: comparison present but a product has no valid offers. The UI shows "No offers with a listed price found" for that product. It never shows a placeholder price.
- Error: Exa authentication failure, credits exhausted, rate limit, timeout, or request cap reached. The UI shows a specific message and no fabricated result.
- Accessibility: keyboard-operable input and links, progress announced through an ARIA live region, table headers marked up.

## Requirements

Draft IDs; the plan index mirrors these once frozen.

- **REQ-001 Ask and stream.** The owner submits a question and sees ordered progress events until a terminal state: `completed`, `failed`, or `cancelled`.
- **REQ-002 Cited comparison.** A completed run shows a comparison of 1-3 candidate products. Each factual paragraph cites at least one source URL returned by Exa for this run.
- **REQ-003 Truthful offers.** Each displayed offer has `source = "exa"`, merchant, numeric price > 0, ISO 4217 currency, `http(s)` URL that Exa returned in this run, availability (`in_stock`, `out_of_stock`, `preorder`, or `unknown`), and `retrievedAt` (ISO 8601). Kensaku drops any candidate offer that lacks a required field. It never invents, edits, or infers a price. The UI labels every price as last observed.
- **REQ-004 Deterministic offer ranking.** Within a product, offers group by currency. Each group sorts by availability (`in_stock`, `preorder`, `unknown`, `out_of_stock`), then by ascending price, then by merchant name. Duplicate URLs collapse to one offer.
- **REQ-005 Failure recovery.** Exa errors (401, 402 or credits exhausted, 429, 5xx, timeout) end the run in `failed` with a typed reason shown to the user. A partial result is labeled partial. The app stays usable for the next question.
- **REQ-006 Spend guard.** A research run makes at most N Exa requests (N to be frozen after the spike; draft 5). It records each response's `costDollars.total` and shows the run total. Exceeding the cap is impossible by construction, not a warning.
- **REQ-007 Local and key safety.** The server binds to `127.0.0.1` only. `EXA_API_KEY` is read server-side from `.env.local` and never reaches the browser, logs, or fixtures.
- **REQ-008 Live acceptance.** Before the MVP is declared complete, a live Exa acceptance suite runs on a fixed query set within the spend cap and meets the thresholds in `EVALUATION_PLAN.md` (D-007).

## Nonfunctional requirements

- Cost: at most N requests per research run, about $0.05 per run at current prices, so roughly 200 runs per month on the $10 free credits.
- Latency target (**ASSUMPTION A-3**): first progress event within 1 s; completed run within 60 s at p50 on the live acceptance set.
- Privacy: no user data leaves the machine except the query text sent to Exa.
- Reliability: one failed Exa call fails or degrades the run visibly; it never silently drops a stage.

## Acceptance

At completion the owner can run the app locally, ask a shopping question, and receive a cited comparison with valid, linked, last-observed offers. The deterministic fixture suite and the live acceptance suite (REQ-008) pass. Human product acceptance remains: the owner judges whether the recommendations are useful.
