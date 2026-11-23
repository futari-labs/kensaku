# Product Spec

Status: proposed for approval with plan `kensaku-v1-2`. It builds on the accepted MVP (plan `kensaku-mvp-v1`, documents at commit `2866477`) and the accepted v1.1 (plan `kensaku-v1-1`, documents at commit `47f813d`), both archived in `docs/futari/archive/`. v1.1 text below is unchanged unless marked **(v1.2)**.

## Users and problem

Kensaku is a personal shopping research assistant that runs on the owner's machine (D-001, D-010). The owner asks a buying question in plain language; Kensaku researches it with Exa, writes a short cited comparison of 1-3 products, and lists direct merchant offers with last-observed prices. Aggregator, review, marketplace, and search pages appear separately as research evidence.

The MVP proved the research is useful, and the owner accepted it on 2026-11-21. v1.1 improves how results look and how relevant they are:

1. Results read like a shopping page: one large, image-first card per product instead of text-heavy tables.
2. Each card shows a real photo of the product, taken from a page in this run's results.
3. Singapore questions return Singapore merchants in SGD instead of US stores.
4. Search-results, category, editorial, and second-hand pages no longer appear as merchant offers (CR-002).
5. Dark mode is the default, with a toggle.

**(v1.2) Simulated commerce.** The owner can now act on the research: pick a merchant offer Kensaku found, add it to a simulated cart, and complete a test payment on Stripe-hosted Checkout in a Stripe sandbox. Nothing is bought from the merchant and no real money moves; every screen says so. The purpose is an end-to-end demonstration of the shopping flow with a real payment provider in test mode.

First valuable outcome for v1.2: after asking "Sony WH-1000XM5 price in Singapore", the owner clicks "Add to cart" on the Harvey Norman offer, opens the cart, sees "Demo checkout price 289.00 SGD" next to "Last observed 289.00 SGD on harveynorman.com.sg", pays on Stripe's sandbox page with the 4242 test card, and returns to "Simulated payment received (Stripe sandbox). No order was placed with harveynorman.com.sg."

First valuable outcome for v1.1: asking "Sony WH-1000XM5 price in Singapore" shows one card with a photo of the headphones from a Singapore merchant's page, a "From 289.00 SGD" price summary, key specifications, a cited reason, and a list of Singapore merchant offers, in the dark theme.

## Scope

Included in v1.1:

- Everything the MVP does stays (REQ-001 to REQ-010). REQ-002, REQ-003, REQ-006, REQ-007, REQ-008, REQ-009, and REQ-010 are amended as listed under Requirements.
- Theme: dark by default for first-time visitors; header toggle; preference persisted; no theme flash; shadcn/ui class-based theming with the existing CSS variables (REQ-011, D-036).
- Image-first product cards: two per row on desktop, one on mobile; large 4:3 image; name, price summary, key specifications, cited reason, merchant offers, collapsed "Other markets" and "Research details" (REQ-012, D-030, D-038).
- Real product images from this run's merchant offer pages or the manufacturer's page, through a local image proxy with a disk cache; loading skeleton, attribution caption, and fallback (REQ-013, REQ-014, D-029).
- Market relevance: market-aware offer search; the card's main list shows only the selected market's currency (REQ-015, D-030, D-033).
- Classification: search and category pages, editorial paths and hosts, second-hand marketplaces, SG aggregators, and unambiguous currency symbols (REQ-016, D-031, D-032).
- A Content-Security-Policy that keeps every browser request on 127.0.0.1 (REQ-007, D-039).

**(v1.2)** Included in v1.2:

- Everything v1.1 does stays (REQ-001 to REQ-016); REQ-007, REQ-008, REQ-009, and REQ-010 are amended as listed under Requirements.
- "Add to cart" on merchant offers registered by a research run on this server; a server-owned cart with one currency at a time (USD, SGD, or JPY), quantities, removal, and clearing (REQ-017, D-046, D-048, D-054).
- A demo checkout price copied from the last-observed price at add time and always shown separately from it (REQ-018, D-045).
- Stripe-hosted Checkout in a sandbox through the official Stripe Node SDK, without currency conversion (REQ-019, D-052).
- Simulated orders driven only by signature-verified webhooks, with success, declined, cancelled, expired, and duplicate-delivery handling (REQ-020, REQ-021, D-047, D-057).
- "Simulated" labeling everywhere, including Stripe's line items (REQ-022).
- Sandbox-only keys enforced at startup and on every Stripe object; credentials only on the server and out of Git (REQ-023, D-050).
- The cart sheet, return states, and order list built from official shadcn/ui components (REQ-024).

Non-goals (unchanged from the MVP unless stated):

- Deployment, hosting, auth, multiple users.
- **(v1.2, narrowed)** Real merchant orders, live Stripe keys or real payments, saved cards or Stripe Customers, refunds, shipping, tax, coupons, receipts by email, multiple carts or users, and Stripe Elements or embedded Checkout. Affiliate revenue, price alerts, price history. (Simulated carts and sandbox checkout are now in scope.)
- Currency conversion or exchange rates. Other-market offers are listed in their own currency only.
- Generated, edited, upscaled, or stock images; image search engines or any image source outside this run's Exa results.
- A theme "system" mode, more themes, or any new design system or custom component library.
- Fixing Exa's model-identifier quality (risks R-6, R-21).
- Any LLM provider other than Exa; markets beyond US, SG, JP; payment providers other than Stripe.
- **(v1.2)** Automating the Stripe-hosted page in tests (D-049); refreshing a demo price after it was added.

## User journeys and UI states

Primary flow:

1. The owner opens `http://127.0.0.1:8787`. The page appears in the dark theme on the first visit, or in the theme they chose last time, with no light flash.
2. They pick a market (default US) and ask a question. Progress shows the four stages, as in the MVP.
3. The answer shows the cited comparison and its Sources, then a "Where to buy" section with one card per product, two per row on a wide screen.
4. Each card: product name; a large image with a skeleton while it loads and a caption such as "Image: harveynorman.com.sg · Sony WH-1000XM5/LME Wireless Noise Cancelling Headphones - Midnight Blue"; a price summary such as "From 289.00 SGD · 5 Singapore offers"; up to 5 key specifications; a "Why it fits" reason with inline citations; the merchant offers in the market's currency (merchant host and name, price with currency code, availability, retrieved time, "View offer"); a collapsed "Other markets (may not ship to Singapore)" section when other-currency offers exist; a collapsed "Research details" section with evidence and rejected counts.
5. The last-observed notice and usage footer remain.
6. The theme toggle in the header switches between dark and light at any time.

States:

- No image: the card shows a neutral "No verified product image" panel of the same size, never a broken image.
- No market-currency offers: "No Singapore offers found" (or United States, Japan) in the main list; other markets stay collapsed; evidence stays in Research details.
- No offers at all: the MVP text "No direct merchant offers with a listed price were found", with the card still showing name, image if any, specs, and reason.
- MVP history: entries saved before v1.1 render as cards without images, specs, or reasons.
- Malformed answer text: when Exa appends leaked structured output to the comparison or a reason (about 1 run in 8), Kensaku shows the text before it, with its citations, and the note "Exa's answer ended in malformed output, which is not shown." (D-042).
- Errors, partial results, cancel, and the 409 notice: unchanged from the MVP.
- Accessibility: everything keyboard-operable; disclosures expose `aria-expanded`; the toggle names the action; zero serious or critical axe violations in both themes.

## (v1.2) Simulated commerce journey

1. After a research answer, each merchant offer in a card (main list and Other markets) has an "Add to cart" button. Offers in history saved before v1.2 show a disabled "Ask again to buy"; out-of-stock and below-minimum offers are disabled with a reason.
2. Adding shows "Added" and updates the header cart count. Adding an offer in another currency opens a dialog: "Your simulated cart has USD items. Replace them with this SGD item?" (Replace / Keep cart).
3. The cart sheet ("Simulated cart") shows the simulation banner, each line with its demo checkout price and, beneath it, the last-observed price with merchant host and time; quantity −/+ (1-10), remove, clear, "Demo total", and "Checkout in Stripe sandbox".
4. Checkout opens Stripe's hosted page in the same tab. Line items read "Simulated: <product>".
5. Paying with a test card returns to Kensaku: "Confirming simulated payment…", then "Simulated payment received (Stripe sandbox). No order was placed with <hosts>." once the verified webhook arrives. The cart is emptied.
6. Going back from Stripe's page (with or without a declined card) returns to "Simulated checkout cancelled. Your cart is unchanged.", plus, best-effort, "The test card was declined." when Stripe reported a decline (Stripe may not send that event, R-30).
7. The cart sheet lists the 10 newest simulated orders with status badges.

States:

- Stripe not configured: cart works; checkout is disabled with "Stripe sandbox is not configured. See README."
- Webhook not arriving: after 20 s, "Still waiting for Stripe's confirmation. Is `stripe listen` running?" while polling continues.
- Checkout start failure: "Couldn't start the Stripe sandbox checkout. Your cart is unchanged." with retry.
- Unknown or mismatched return link: "Unknown checkout" and no state change.
- Abandoned checkout past its 60-minute expiry with no webhook: the order shows "Checkout link expired"; the next checkout supersedes it.
- Checkout is used at `http://127.0.0.1:8787` under `pnpm start`; Stripe returns there.
- Commerce store unreadable: commerce disabled with a visible error; research still works.
- Accessibility: keyboard-operable, focus management in the sheet and dialog, polite live announcements, zero serious or critical axe violations in both themes.

## Requirements

REQ-001 to REQ-010 carry over from the MVP. Changes:

- **REQ-002** adds the leaked-structure cut for the comparison (D-042).
- **REQ-003** keeps the MVP rules; the v1.1 additions are REQ-016, and the MVP cases L29 and Y03 are superseded (D-031, D-032).
- **REQ-006** adds that image fetching never uses Exa or the request budget.
- **REQ-007** adds a Content-Security-Policy and applies the Host/Origin guard to `/api/image/:id`.
- **REQ-008** becomes the 8-query v1.1 live suite (EV-016) in place of EV-008.
- **REQ-009** adds that MVP history renders as v1.1 cards.
- **REQ-010** covers both themes and the v1.1 cards.

New:

- **REQ-011 Theme.** Dark by default regardless of the OS setting; header toggle with an action-naming accessible name; `localStorage["kensaku.theme.v1"]` holds `dark` or `light`; a blocking head script applies the theme before the app bundle, so there is no flash; invalid or unavailable storage falls back to dark; only the shadcn `.dark` class and existing CSS variables.
- **REQ-012 Image-first product cards.** Two cards per row at 1280 px (each at least 480 px wide), one at 375 px with no horizontal scroll; full-bleed 4:3 image (at least 360 px tall on desktop; at least 300 px wide, so 225 px tall, at 375 px); content order and labels as in the journey; the product heading never names a merchant; reason citations use AI Elements `inline-citation`.
- **REQ-013 Real product images.** Up to 4 candidates per product chosen by rules I1 and I2 from this run's offer pages or the manufacturer's page; skeleton, ordered fallback, "No verified product image"; caption with source host and page title; alt text "<brand> <name>, image from <host>"; nothing generated or edited.
- **REQ-014 Image proxy safety and cache.** Only run-registered ids; cross-site requests refused (`Sec-Fetch-Site`, `Cross-Origin-Resource-Policy: same-origin`); ports 80 and 443 only; public addresses only, checked on every redirect and pinned for the connection; no cookies or Referer; 8 s, 5 MiB, rule I3; nosniff and a `default-src 'none'` CSP on image responses; images reused for 7 days, rejections cached 24 hours, upstream failures 10 minutes, entries pruned after 30 days, 500 MB cap; no Exa use.
- **REQ-015 Market relevance.** Offer query `"<brand> <name> price <market name> buy"`; main list and price summary in the market's currency only; other currencies collapsed under "Other markets"; prices shown as amount plus ISO code.
- **REQ-016 Non-merchant pages and currency symbols.** Rule additions 4, 5, 5a, 5b, 5c, and 7 (ARCHITECTURE); EV-011 passes 79/79 including the run 1 Rakuten search page.

**(v1.2)** Amendments to carried requirements:

- **REQ-007** adds the single navigation exception to Stripe-hosted Checkout (D-055); commerce routes and the webhook sit behind the same Host/Origin guard; the CSP is unchanged.
- **REQ-008** becomes the v1.2 live sandbox acceptance, EV-023 (D-044). EV-016's committed v1.1 runs stay as history.
- **REQ-009** adds that history entries keep working; offers stored without an id render with "Ask again to buy".
- **REQ-010** covers the commerce UI in both themes.

**(v1.2)** New:

- **REQ-017 Registered offers and cart rules.** Only server-registered offers can be added; the API accepts only `offerId`, `quantity`, `replace`; one currency per cart; quantity 1-10, ≤ 20 lines, Stripe minimums, total cap; error codes and precedence exactly as in `evals/cases/commerce-rules.json` (EV-018).
- **REQ-018 Demo price distinct from observed price.** The demo unit price is the observed price in minor units, copied at add time and never refreshed; every cart line shows "Demo checkout price" and, separately, "Last observed … on <host>, <time>"; Stripe's line description repeats the distinction (EV-018, EV-019, EV-022).
- **REQ-019 Stripe-hosted Checkout.** `stripe@23.1.0`, `apiVersion 2026-10-28.endive`, the exact session request frozen in EV-019 (no conversion, 60-minute expiry, idempotency key); the browser navigates only to a server-returned `https://checkout.stripe.com/` URL.
- **REQ-020 Verified webhooks and order state.** Raw-body signature verification with 300 s tolerance; live-mode refusal; event-id dedupe; matching by order id, session id, amount, and currency; transitions exactly as in `evals/cases/webhook-events.json`; only a verified paid event sets paid (EV-020).
- **REQ-021 Scenarios.** Success, declined, cancelled, expired or superseded, and duplicate delivery each end in the defined state, deterministically in CI (EV-020, EV-022) and live in the sandbox (EV-023).
- **REQ-022 Simulated labeling.** The fixed label strings in ARCHITECTURE "Labels" appear where specified; the forbidden phrases never appear; Stripe line items start with "Simulated:" (EV-019, EV-022, EV-023 owner audit).
- **REQ-023 Sandbox-only keys and secret handling.** Startup refuses live or malformed keys; any `livemode: true` object is refused; keys and secrets never reach the browser, logs, responses, stored state, fixtures, or tracked files (EV-021).
- **REQ-024 Commerce UI.** Add-to-cart buttons and disabled reasons, the currency-replace dialog, the cart sheet, the checkout return panel, and the order list per the journey above, using official shadcn/ui components unmodified (EV-022).

Full acceptance criteria are in `.futari/plan.json`.

## Nonfunctional requirements

- Cost: unchanged per question (about $0.035; at most 5 Exa requests). Images add no Exa cost. The longer `/answer` schema did not change the reported price in the spike ($0.005).
- Latency (reported in EV-016, not gating): first progress event within 1 s; completed run within 45 s at the median; an image typically appears within 2 s of its card when the merchant's CDN responds.
- Privacy: the browser contacts only 127.0.0.1. The server contacts Exa with the question (as in the MVP) and merchant image hosts with plain image requests that carry no cookies, credentials, or Referer.
- **(v1.2)** Cost: Stripe sandbox calls cost nothing; live acceptance uses at most 30 Exa requests and $0.40 of free credits plan-wide (D-051).
- **(v1.2)** Latency (reported, not gating): `POST /api/checkout` answers within 3 s at the median; a paid order is shown within 2 s of the webhook delivery.
- **(v1.2)** Privacy: Stripe receives product names, merchant hosts, prices, and the payment details the owner types on Stripe's page; Kensaku sends no images, no question text, and no customer data.
- Disk: the image cache under `.cache/images/` reuses images for 7 days and then refetches them. Entries are pruned 30 days after their last registration, and the bytes are capped at 500 MB in total.

## Acceptance

**(v1.2)** The owner can run `pnpm start` with sandbox credentials and `stripe listen`, research in US, SG, and JP, add verified offers to the simulated cart, pay in the Stripe sandbox in USD, SGD, and JPY, see declined and cancelled checkouts end cleanly, and see that a duplicate webhook changes nothing. Deterministic suites EV-001 to EV-007, EV-009 to EV-015, and EV-017 to EV-022 pass in CI on `dev`; EV-023 passes locally with the owner's audit; the owner records v1.2 product acceptance. Promotion to `main` and deployment stay outside the plan.

(v1.1, completed)

The owner can run `pnpm start`, see the dark theme by default, toggle it, ask questions in US, SG, and JP, and get image-first cards with real product photos, Singapore offers in SGD for Singapore questions, and no search or category pages listed as offers. Deterministic suites EV-001 to EV-007, EV-009 to EV-015, and EV-017 pass in CI on `dev`; EV-016 passes locally; the owner records v1.1 product acceptance. Promotion to `main` stays a separate owner decision (D-021).
