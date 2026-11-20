# Product Spec

Status: proposed for approval with plan `kensaku-mvp-v1`.

## Users and problem

Kensaku is a personal shopping research assistant. The first user is the owner, running it on their own machine (D-001 narrowed by D-010).

The owner asks a buying question in plain language, such as "best noise-cancelling headphones for flights under $400" or "Sony WH-1000XM5 price in Singapore". Doing this by hand means reading reviews, comparing specs, and checking several stores. Kensaku researches the question with Exa, compares a few candidates with citations, and lists direct merchant offers with last-observed prices and links. Aggregator and review pages appear separately as research evidence.

First valuable outcome: one question produces a short cited comparison of 1-3 products and, for each product found at direct merchants, a ranked list of offers that link to the merchant's own product page.

## MVP and non-goals

Included:

- Local web app on `127.0.0.1`, no auth (D-010).
- Chat-style interface built from official AI Elements and shadcn/ui components (D-003, D-018) that streams research progress.
- Exa as the only data and reasoning provider, through the `exa-js` SDK (D-004, D-008, D-019).
- Markets US, SG, JP; offers in USD, SGD, JPY kept in original currency; no cross-currency numeric comparison (D-014).
- Only direct, validated merchant product pages are offers; aggregator, marketplace comparison, review, and price-less pages are labeled evidence (D-015).
- Every offer is source-reported and last-observed, with source, merchant, currency, URL, and retrieval time (D-006).
- Conversation history persists locally across reloads with a clear-history control (D-016).
- At most 5 Exa requests per question (target 1-3), caching, monthly limits, $0 additional spend (D-005, D-017).

Non-goals:

- Deployment, hosting, auth, multiple users (later milestone).
- Checkout, carts, affiliate revenue, price alerts, price history.
- Currency conversion or exchange rates.
- Guaranteed or real-time price or stock.
- Any LLM provider other than Exa.
- Markets or currencies beyond US/USD, SG/SGD, JP/JPY.
- Editing or restyling AI Elements or shadcn/ui component source.

## User journeys and UI states

Primary flow:

1. The owner opens `http://127.0.0.1:8787`, picks a market (default US), and types a question or picks a suggestion.
2. Progress shows the stages in order: finding candidates, gathering offers, validating offers, writing the comparison.
3. The answer shows the comparison with inline citations, then one section per product: offer table (merchant, price and currency, availability, retrieved time, link), grouped by currency with the market's currency first; then labeled research evidence.
4. A notice states that prices and availability are last observed by Exa and must be confirmed on the merchant's page.
5. A footer shows the run's Exa requests, cache hits, and reported cost, plus the month's usage against its limit.

States:

- Empty: market selector, input, example questions.
- Running: stage list with current stage; input disabled; Cancel available.
- No offers: "No direct merchant offers with a listed price were found" per product, with any evidence still shown. Never a placeholder price.
- Partial: earlier stages' results stay visible and are labeled partial when a later stage fails.
- Error: specific messages for Exa authentication failure, exhausted free credits, monthly limit reached, rate limit, Exa unavailable, timeout, cancelled, invalid request, and "A research run is already in progress".
- History: restored on reload; Clear history asks for confirmation.
- Accessibility: keyboard-operable throughout, progress announced through an ARIA live region, table headers and link text meaningful, no serious or critical axe violations.

## Requirements

- **REQ-001 Ask and stream.** The owner submits a question and sees ordered progress events until exactly one terminal state: completed, failed, or cancelled.
- **REQ-002 Cited comparison.** A completed run shows a comparison of 1-3 candidate products. Citation markers resolve to source URLs returned by Exa in this run; unresolvable markers are removed; paragraphs without a resolved citation are visibly flagged uncited.
- **REQ-003 Authentic, relevant merchant offers.** Each displayed offer comes from a direct merchant product page returned by Exa in this run, matches the candidate's model identity, and has merchant, positive price, supported ISO currency, canonical http(s) URL, availability (`in_stock`, `out_of_stock`, `preorder`, `unknown`), source `exa`, and retrieval time. Aggregator, marketplace comparison, editorial, non-listing, price-less, and merchant-mismatch pages appear only as labeled evidence. Irrelevant products, unsupported currencies, and URLs not from the run never appear as offers. Kensaku never invents or edits a price.
- **REQ-004 Currency-safe ranking.** Offers group by currency (USD, SGD, JPY), the selected market's currency first. Within a group they sort by availability, then price ascending, then merchant host, then URL; duplicate URLs collapse. No price is compared across currencies.
- **REQ-005 Failure recovery.** Exa errors (401, 402 or exhausted credits, 429, 5xx, timeout) and cancellation end the run with a typed, user-visible reason. Partial results are labeled. The app remains usable for the next question. Kensaku never falls back to fixture data in live mode.
- **REQ-006 Spend guard and cache.** At most 5 Exa requests per question by construction, 3 or fewer for a normal question. Repeated questions within 6 hours are served from cache with their original retrieval time and no request. Monthly request and cost limits, and Exa's exhausted-credit signal, stop live calls before they are made. Every response's reported cost is recorded and shown.
- **REQ-007 Local and key safety.** The server listens only on 127.0.0.1 and rejects foreign Host or Origin headers. `EXA_API_KEY` is read server-side only and never appears in the browser bundle, browser storage, logs, cache files, fixtures, or API responses.
- **REQ-008 Live acceptance.** Before the MVP is declared complete, the live suite of 6 queries across US, SG, and JP meets the thresholds in `EVALUATION_PLAN.md` within the live usage limits.
- **REQ-009 Persistent local history.** The conversation, including rendered results, survives page reloads through versioned, validated `localStorage`; Clear history (with confirmation) removes it; invalid stored data is discarded with a notice; no secret is stored in the browser.
- **REQ-010 Frontend quality and components.** The interface uses unmodified official AI Elements and shadcn/ui components installed from their registries, offers a market selector that persists, meets the accessibility and layout checks in EV-007, and passes the owner's visual review.

## Nonfunctional requirements

- Cost: about $0.035 per normal question (1 answer plus 2 searches at spike prices); roughly 280 questions per month on $10 of free credits; hard per-question and monthly limits.
- Latency targets (measured in EV-008, reported, not gating): first progress event within 1 s; completed run within 45 s at the median.
- Privacy: only query text leaves the machine (to Exa). History stays in the browser.
- Reliability: no silent stage drops; every failure is typed and shown.

## Acceptance

The owner can run `pnpm start`, ask shopping questions in any of the three markets, and receive cited comparisons with authentic, relevant, last-observed merchant offers and separately labeled evidence. Deterministic suites EV-001 to EV-007 and EV-009 pass in CI on `dev`, EV-008 passes locally, and the owner records product acceptance, including whether the recommendations are useful. Promotion to `main` is a separate owner decision (D-021).
