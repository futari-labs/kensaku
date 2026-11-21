# Product Spec

Status: proposed for approval with plan `kensaku-v1-1`. It builds on the accepted MVP (plan `kensaku-mvp-v1`, archived in `docs/futari/archive/kensaku-mvp-v1/`; MVP documents at commit `2866477`).

## Users and problem

Kensaku is a personal shopping research assistant that runs on the owner's machine (D-001, D-010). The owner asks a buying question in plain language; Kensaku researches it with Exa, writes a short cited comparison of 1-3 products, and lists direct merchant offers with last-observed prices. Aggregator, review, marketplace, and search pages appear separately as research evidence.

The MVP proved the research is useful, and the owner accepted it on 2026-11-21. v1.1 improves how results look and how relevant they are:

1. Results read like a shopping page: one large, image-first card per product instead of text-heavy tables.
2. Each card shows a real photo of the product, taken from a page in this run's results.
3. Singapore questions return Singapore merchants in SGD instead of US stores.
4. Search-results, category, editorial, and second-hand pages no longer appear as merchant offers (CR-002).
5. Dark mode is the default, with a toggle.

First valuable outcome for v1.1: asking "Sony WH-1000XM5 price in Singapore" shows one card with a photo of the headphones from a Singapore merchant's page, a "From 289.00 SGD" price summary, key specifications, a cited reason, and a list of Singapore merchant offers, in the dark theme.

## Scope

Included in v1.1:

- Everything the MVP does stays (REQ-001 to REQ-010). REQ-003, REQ-006, REQ-007, REQ-008, REQ-009, and REQ-010 are amended as listed under Requirements.
- Theme: dark by default for first-time visitors; header toggle; preference persisted; no theme flash; shadcn/ui class-based theming with the existing CSS variables (REQ-011, D-036).
- Image-first product cards: two per row on desktop, one on mobile; large 4:3 image; name, price summary, key specifications, cited reason, merchant offers, collapsed "Other markets" and "Research details" (REQ-012, D-030, D-038).
- Real product images from this run's merchant offer pages or the manufacturer's page, through a local image proxy with a disk cache; loading skeleton, attribution caption, and fallback (REQ-013, REQ-014, D-029).
- Market relevance: market-aware offer search; the card's main list shows only the selected market's currency (REQ-015, D-030, D-033).
- Classification: search and category pages, editorial paths and hosts, second-hand marketplaces, SG aggregators, and unambiguous currency symbols (REQ-016, D-031, D-032).
- A Content-Security-Policy that keeps every browser request on 127.0.0.1 (REQ-007, D-039).

Non-goals (unchanged from the MVP unless stated):

- Deployment, hosting, auth, multiple users.
- Checkout, carts, affiliate revenue, price alerts, price history.
- Currency conversion or exchange rates. Other-market offers are listed in their own currency only.
- Generated, edited, upscaled, or stock images; image search engines or any image source outside this run's Exa results.
- A theme "system" mode, more themes, or any new design system or custom component library.
- Fixing Exa's model-identifier quality (risks R-6, R-21).
- Any LLM provider other than Exa; markets beyond US, SG, JP.

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
- Errors, partial results, cancel, and the 409 notice: unchanged from the MVP.
- Accessibility: everything keyboard-operable; disclosures expose `aria-expanded`; the toggle names the action; zero serious or critical axe violations in both themes.

## Requirements

REQ-001 to REQ-010 carry over from the MVP. Changes:

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

Full acceptance criteria are in `.futari/plan.json`.

## Nonfunctional requirements

- Cost: unchanged per question (about $0.035; at most 5 Exa requests). Images add no Exa cost. The longer `/answer` schema did not change the reported price in the spike ($0.005).
- Latency (reported in EV-016, not gating): first progress event within 1 s; completed run within 45 s at the median; an image typically appears within 2 s of its card when the merchant's CDN responds.
- Privacy: the browser contacts only 127.0.0.1. The server contacts Exa with the question (as in the MVP) and merchant image hosts with plain image requests that carry no cookies, credentials, or Referer.
- Disk: the image cache under `.cache/images/` reuses images for 7 days and then refetches them. Entries are pruned 30 days after their last registration, and the bytes are capped at 500 MB in total.

## Acceptance

The owner can run `pnpm start`, see the dark theme by default, toggle it, ask questions in US, SG, and JP, and get image-first cards with real product photos, Singapore offers in SGD for Singapore questions, and no search or category pages listed as offers. Deterministic suites EV-001 to EV-007, EV-009 to EV-015, and EV-017 pass in CI on `dev`; EV-016 passes locally; the owner records v1.1 product acceptance. Promotion to `main` stays a separate owner decision (D-021).
