# Evaluation Plan

Status: proposed for approval with plan `kensaku-v1-1`. EV-001 to EV-007 and EV-009 carry over from `kensaku-mvp-v1`. Their descriptions and pass rules in `.futari/plan.json` are copied verbatim from the archived MVP plan, with v1.1 additions marked "(v1.1)". EV-008 is retired: its run 1 log and audit stay in `.futari/evidence/live/` as history, and EV-016 replaces it. EV-010 to EV-017 are new.

## Traceability

| Eval | Requirements | Cases / fixture | Command | Pass rule |
| --- | --- | --- | --- | --- |
| EV-001 Merchant authenticity | REQ-003, REQ-016 | `evals/cases/offer-classification.json` (54, unchanged) plus the `supersedes` block of `offer-classification-v1-1.json` (L29, Y03) | `pnpm vitest run tests/evals/ev-001-merchant-authenticity.test.ts && node evals/harness.mjs --strict` | MVP rule verbatim (54/54 outcome, category, and offer fields; count asserted). (v1.1) L29 and Y03 are compared with their superseding labels, the test asserts that exactly those two were replaced, and harness `--strict` exits 0. |
| EV-002 Product relevance | REQ-003 | MVP cases | `pnpm vitest run tests/evals/ev-002-product-relevance.test.ts` | 100% of cases are `irrelevant-product` exactly when labeled. |
| EV-003 Currency and ranking | REQ-004 | `ranking-currency.json` plus the property test | `pnpm vitest run tests/evals/ev-003-ranking-currency.test.ts` | All 4 cases match exactly; the seeded 1,000-list property test finds no mixed-currency group and no lost or duplicated offers. |
| EV-004 Citations | REQ-002 | `citations.json` (6) and `citations-spaced.json` (2) plus fixture pipeline runs | `pnpm vitest run tests/evals/ev-004-citations.test.ts` | All 6 + 2 cases match; the test asserts each file's evaluated count, and harness `--strict` exits 0. In fixture pipeline runs every rendered source URL is a citation of the run and every offer URL is a search result of the run. |
| EV-005 Spend guard and cache | REQ-006 | `FixtureExaPort` scenarios with call counting | `pnpm vitest run tests/evals/ev-005-spend-guard.test.ts` | MVP rule verbatim, both levels: unit (sixth token refused, cache hits keep `retrievedAt`, limits block before calling, 402 blocks later calls) and run (≤ 5 calls in every scenario, ≤ 3 for a normal question, 0 for a cached repeat, 409 for a concurrent run). (v1.1) A fixture run that loads every product image leaves `RequestBudget.used` and the ledger identical to the same run without image loads. |
| EV-006 Streaming and failure states | REQ-001, REQ-005 | Hono app with scripted scenarios | `pnpm vitest run tests/evals/ev-006-stream-failures.test.ts` | MVP rule verbatim: for success, no candidates, no offers, 401, 402, 429, 500, and timeout, the stream has ordered progress parts, exactly one terminal state, the expected `data-error` kind and `partial`, and no fixture data in live mode. A client abort aborts the Exa call, emits no further parts, and logs `cancelled`. The lock is released after every scenario. |
| EV-007 Frontend quality | REQ-001, REQ-002, REQ-003, REQ-007, REQ-009, REQ-010 | Playwright, fixture mode | `pnpm test:e2e && node scripts/check-components.mjs` | "Frontend quality (EV-007, amended)" below; owner visual review of v1.1 recorded in `.futari/evidence/JM-105.md`. |
| EV-009 Local and key safety | REQ-007 | Server start tests, a self-made build, logs, caches, fixtures | `pnpm vitest run tests/evals/ev-009-key-safety.test.ts` | MVP rule verbatim (127.0.0.1 only; foreign Host or Origin get 403; key absent from the build, logs, `.cache/`, `evals/fixtures/`, and responses). (v1.1) Key absent from `.cache/images/` after a run that loads images; `GET /` carries exactly the ARCHITECTURE CSP; `/api/image/:id` with a foreign Host gets 403. |
| EV-010 Theme | REQ-011, REQ-010 | Playwright, fixture mode | `pnpm exec playwright test tests/e2e/ev-010-theme.spec.ts` | "Theme (EV-010)" below. |
| EV-011 Non-merchant pages and currency symbols | REQ-016, REQ-003 | `evals/cases/offer-classification-v1-1.json` (79: 41 live, 38 synthetic) | `pnpm vitest run tests/evals/ev-011-page-classification.test.ts` | 79/79 outcome and category; offers also currency and amount; asserts the case count. |
| EV-012 Product card content | REQ-012 | `evals/cases/product-content.json` (6 answers, 14 candidates) | `pnpm vitest run tests/evals/ev-012-product-content.test.ts` | Every candidate's `keySpecs` and resolved reason (or `null`) equal the labels; asserts case and candidate counts. |
| EV-013 Product image selection | REQ-013 | `evals/cases/image-selection.json` (80 URL, 10 selection, 58 bytes cases) | `pnpm vitest run tests/evals/ev-013-image-selection.test.ts` | Every case equals its label. Selection cases compare exact ordered `{imageUrl, pageUrl}` lists, using `classifyHit` on the real fixtures or on the inline synthetic hits. Asserts each section's count. |
| EV-014 Image proxy safety and cache | REQ-014, REQ-007 | Injected resolver and upstream, a local connector test, generated image bytes | `pnpm vitest run tests/evals/ev-014-image-proxy.test.ts` | "Image proxy (EV-014)" below. |
| EV-015 Image-first product cards | REQ-012, REQ-013, REQ-015, REQ-009, REQ-010 | Playwright, fixture mode, scenarios with fixture images, the frozen MVP history | `pnpm exec playwright test tests/e2e/ev-015-product-cards.spec.ts` | "Product cards (EV-015)" below. |
| EV-016 Live acceptance v1.1 | REQ-008, REQ-013, REQ-015, REQ-016 | `evals/cases/live-acceptance-v1-1.json` (8 queries) | `pnpm live:acceptance:v1-1` | "Live acceptance (EV-016)" below. |
| EV-017 Request contract | REQ-015, REQ-012 | Frozen requests in V9, V2, V3 | `pnpm vitest run tests/evals/ev-017-request-contract.test.ts` | The `/answer` `outputSchema` deep-equals V9's frozen `request.body.outputSchema`. The offer requests for V2's and V3's candidates equal their frozen `query` and `userLocation`, with the MVP contents unchanged. A US and a JP candidate get `"… price United States buy"` and `"… price Japan buy"`. The cache key differs from the MVP query's key. |

## Fixtures and provenance

- MVP fixtures (`evals/fixtures/exa-live/S1`-`S9`, `A1`-`A4`) are unchanged.
- `V1`-`V10`: real Exa responses from the v1.1 pre-approval spike (D-028, 10 of 10 requests), labeled `LIVE EXA RESPONSE`, with the exact request, timestamps, and status. `R1-Q5-offers-xm5` and `R1-Q6-offers-paperwhite` are byte-for-byte copies of two EV-008 run 1 search responses; provenance fields name the log and indexes. No credentials: the harness scans every file in the fixture directories, and EV-009 checks too.
- `evals/fixtures/history/mvp-history-xm5-sg.json`: a real `kensaku.history.v1` value stored by the accepted MVP build. It was captured by driving the app in fixture mode (scenario `xm5-sg`, market SG) with a `src` tree identical to `a3a2894`, as asserted during capture. It is loaded into `localStorage` unchanged for REQ-009 and EV-015 check 8.
- Gold labels in the four v1.1 case files are **assistant-proposed**. They were computed by reference implementations of the written rules, which are independent of `src/`, and checked by hand. They become gold only through the owner's plan approval.
  - The independent reviewer's own implementation agreed with every label.
  - For classification, both implementations reproduce all 54 MVP labels under the MVP rules. Under the v1.1 rules only L29 and Y03 change, and both are recorded as supersessions.
  - Mutation check with the reviewer's scripts: every single-element mutation of the v1.1 classification rules (39) and every I1 and I3 mutation in the image script makes at least one frozen case fail.
- Non-obvious labels the owner approves with the plan:
  - N06: the Challenger collection page becomes evidence, not an offer.
  - N07: Mobyshop's USD price on an SG site stays a USD offer, shown under Other markets.
  - N08: Amazon SG `S$310` becomes an SGD offer.
  - N26, N27, N30: Bose listings are rejected as irrelevant because Exa's identifier "QuietComfort Headphones" is not contiguous in their titles (R-21, safe direction).
  - I07: no image for the Kindle in JP, because Amazon JP's only image is its logo.
  - B33, B34, B53: Logitech's 1200×630 logo card fails I3's 1.8 aspect limit.
  - P04: V9's malformed reason is not shown.
  - L29, Y03: the supersessions.
- Synthetic cases (Z01-Z38, the synthetic U, I, and B cases, P06) are marked synthetic.
- Fixture images under `tests/fixtures/images/` (created by JM-103) are synthetic, solid-colour images of known type and size, labeled synthetic. They exist so CI never fetches the internet and are never shown in live mode.
- Image bytes from the probe are not committed. The bytes cases record only the measured type, dimensions, and size.

## Historical live logs

The committed MVP live logs (`.futari/evidence/live/jm-004-smoke-*.json`, `ev-008-run-1-*.json`) are history. `tests/research/live-smoke-revalidation.test.ts` keeps re-deriving their displayed offers with the current rules. Under the v1.1 rules exactly one displayed offer changes: Q5-O1 (`search.rakuten.co.jp`) becomes evidence `search-or-category`, which is the CR-002 fix. JM-101 updates that test to assert exactly this difference and nothing else (independent review finding 2).

## Harness and baseline

`node evals/harness.mjs` validates every frozen case file and fixture and reports each evaluation's readiness without running product code. Baseline on this planning branch, 2026-11-21:

```
HARNESS OK: 54 classification cases (40 live), 4 ranking cases, 6 citation cases (+2 spaced), 6 MVP live queries; v1.1: 79 classification cases (+2 supersessions), 6 content cases, 80/10/58 image url/selection/bytes cases, 8 live queries.
EV-001: READY (kensaku-v1-1 supersessions L29/Y03 pending JM-101)
EV-002 .. EV-007, EV-009: READY
EV-010, EV-012 .. EV-017: NOT RUNNABLE (product module or test does not exist)
EV-011: NOT RUNNABLE (test does not exist)
```

`node evals/harness.mjs --strict` fails until JM-101 makes the EV-001 test load `offer-classification-v1-1.json`. JM-101 lists it as a verification command. Default mode stays exit 0, so `dev` CI is green until then (the CR-001 pattern). CI runs the harness without `--strict`, and the completion condition requires `--strict` locally at the final head.

States stay distinct: **harness valid**, **not runnable** (product module or test file missing), **product assertion failing**, and **blocked** (an external dependency such as Exa, a merchant image host, or the browser runtime is unavailable). Only a run of the listed command produces PASS or FAIL. A merchant image host refusing a live fetch is an expected outcome measured by EV-016, not an error.

Tests for EV-001, EV-011, EV-012, and EV-013, and the EV-016 script, load their frozen case files directly. They may not copy, filter, or edit cases, and they assert the evaluated counts. The harness fails a READY test file that does not reference its case file.

## AI quality

Kensaku still runs no model of its own. v1.1 adds two Exa-generated fields (key specs and reason) and one Exa-extracted field (the page image):

- Key specs and reasons are checked structurally: normalization, citation resolution, and the malformed-reason rule in EV-012; the exact schema in EV-017. The owner judges their usefulness in EV-016 and product acceptance. No LLM judge is used.
- The tighter `modelIdentifiers` description (D-037) was tested on two questions. Q2 now returns one clean identifier; Q6 still returns a weak one (R-21). EV-016's offer audit measures the effect.
- Image correctness cannot be decided by rules. Rules I1-I3 remove known junk, and EV-016's owner image audit measures the rest. With the 1.8 aspect limit, every image in the spike's visual check that would still be shown was correct. This is a sanity baseline, not a statistical guarantee (R-3, R-17).

## Theme (EV-010)

Playwright, Chromium, `pnpm start` in fixture mode:

1. **Default.** A fresh context (empty storage) emulating `prefers-color-scheme: light` loads the page: `<html>` has class `dark`, `getComputedStyle(document.documentElement).colorScheme` is `dark`, and the body background equals the computed `--background` of `.dark`.
2. **No flash, before the bundle.** With every request for the app's module bundle delayed by 2 s (Playwright route), the theme checks hold before the bundle runs: with empty storage, dark class and dark background; with `kensaku.theme.v1 = "light"`, no dark class and a light background.
3. **No flash, through load.** An init script installs a `MutationObserver` on `<html>` before any page script runs and records every class change. After the page is idle with empty storage, the recorded history never shows `<html>` without `dark`. With `light` stored, it never shows `dark`.
4. **Toggle.** The header has a button with accessible name "Switch to light theme". Activating it with the keyboard (Tab to it, Enter) removes the dark class, stores `light`, and changes the name to "Switch to dark theme". A mouse click switches back and stores `dark`.
5. **Persistence.** After choosing light and reloading, the page is light. A new page in the same context is also light.
6. **Fallbacks.** A stored value of `"blue"` renders dark. With `localStorage` access throwing (init script), the page renders dark, the toggle still switches the current page, and no uncaught error is logged.
7. **Accessibility.** `@axe-core/playwright` reports zero serious or critical violations in both themes on the empty state, a completed `xm5-sg` run, and an error state.
8. **Theming convention.** The theme is applied only through the `dark` class on `<html>` and `color-scheme`; the theme code sets no inline colour styles. Component integrity is checked by `scripts/check-components.mjs` (EV-007), and the unchanged `src/web/index.css` by the JM-102 and JM-105 reviewers.

## Image proxy (EV-014)

Vitest against the Hono app factory, with an injected `lookup` and an injected upstream (no internet), plus one connector test against a local server:

1. An unknown id, or an id that is not 64 lowercase hex characters, gets 404. The injected upstream receives no request.
2. A registered id whose host resolves to any of these addresses gets 502, and no connection is attempted: 127.0.0.1, 10.1.2.3, 172.16.0.1, 192.168.1.1, 169.254.169.254, 100.64.0.1, 0.0.0.0, 192.0.2.1, ::1, ::, fc00::1, fe80::1, fec0::1, ff02::1, ::ffff:127.0.0.1, ::127.0.0.1, 64:ff9b::7f00:1, 2001::1, 2002:7f00:1::1, 2001:db8::1.
3. Registered URLs with literal or unusual hosts get 502 without a DNS lookup or connection: `http://127.0.0.1/a.jpg`, `http://[::1]/a.jpg`, `http://2130706433/a.jpg`, `http://0x7f.1/a.jpg`. A URL on `localhost` resolved to 127.0.0.1 also gets 502. Ports other than 80 and 443 get 502: `https://cdn.example.com:8443/a.jpg`, `http://cdn.example.com:22/a.jpg`.
4. A public host that redirects to a private address gets 502. A chain of 4 redirects gets 502. A chain of 3 public redirects to a valid image succeeds.
5. Pinning, routing level: when the injected resolver returns a public address first and a private one on a second lookup, the request goes to the public address, and the second lookup is never used for that hop.
6. Pinning, connector level: `NetworkImageFetch` is given a URL with a `.invalid` hostname and a checked address that points to a local test HTTP server. The server receives the request with the original `Host` header, and no DNS lookup is attempted (the test's lookup spy is never called). This runs the real `node:http` path.
7. The upstream request has no `Cookie`, `Authorization`, or `Referer` header, and its `Accept` header is exactly as in ARCHITECTURE.
8. Bytes over 5 MiB get 502, and reading stops at the limit. An upstream that never finishes gets 502 within 8.5 s, measured with fake timers.
9. Generated images: a 400×300 JPEG, PNG, WebP, and AVIF are each served with:
   - the sniffed `Content-Type`;
   - `X-Content-Type-Options: nosniff`;
   - `Content-Security-Policy: default-src 'none'`;
   - `Cross-Origin-Resource-Policy: same-origin`;
   - `Cache-Control: private, max-age=604800`.

   The upstream's own `Content-Type` (for example `text/html`) and `Set-Cookie` are ignored and never forwarded. A 1×1 GIF, an SVG document, a 150×400 PNG, and a 1200×630 WebP each get 422.
10. Cross-site: a request with `Sec-Fetch-Site: cross-site` or `same-site` gets 403 without any upstream request. A request with `same-origin`, or with no `Sec-Fetch-Site` header, is served. A foreign `Host` gets 403.
11. Cache lifecycle (fake clock):
    - A second request within 7 days is served from disk with no upstream request. At 7 days plus a second it refetches.
    - A 422 is reused for 24 hours. A 502 is reused for 10 minutes and refetched after.
    - An entry registered 31 days ago is pruned at startup, and its id then gets 404.
    - With the cap lowered for the test, the oldest bytes are evicted first and refetched on demand.
12. Concurrency: 10 simultaneous requests for one id cause exactly 1 upstream request. Requests for 10 different ids never have more than 4 upstream requests in flight.
13. Hygiene: a run's registration writes no key and no request header to `.cache/images/`. Serving images changes neither `RequestBudget.used` nor the Exa ledger.

## Product cards (EV-015)

Playwright, Chromium, `pnpm start` in fixture mode. Scenarios (JM-104 adds the first two, JM-105 the rest):
- `xm5-sg-cards`: SG market, 2 candidates; SGD offers plus one USD offer; image candidates mapped to fixture images, one of which fails rule I3.
- `xm5-us-cards`.
- `no-images`: every candidate fails.
- `no-market-offers`: SG market, USD offers only.

1. **Layout.**
   - At 1280×800 the first two cards share a top edge (±2 px), and each is at least 480 px wide. The image box is full-bleed (its width equals the card's border-box width minus the card's border, ±2 px), 4:3 (±1 px), and at least 360 px tall.
   - At 375×812 the cards stack (each card's top is below the previous card's bottom). The image box is full-bleed and at least 300 px wide, and `document.scrollingElement.scrollWidth <= innerWidth`.
2. **Content order.** Each card's DOM order is:
   1. heading;
   2. image box with caption;
   3. price summary;
   4. specs list (at most 5 items);
   5. "Why it fits" reason with at least one inline citation;
   6. merchant offer list;
   7. Other markets disclosure (only when other-currency offers exist);
   8. Research details disclosure.
3. **Product versus merchant.** The card heading equals the candidate's brand and name and contains no merchant host. Each offer item shows the merchant host, merchant name, price with ISO code, availability badge, `<time>` retrieved, and a "View offer" link with an accessible name naming product and merchant.
4. **Images.**
   - While a delayed image loads, a skeleton is visible and the alt text is set.
   - The rule-I3-failing first candidate is skipped and the next one shows, with a caption naming that candidate's host and source title.
   - In `no-images`, each card shows "No verified product image" at the same box size, and no `img` element is in the `error` state.
5. **No third-party requests.** During every scenario, every browser request URL has origin `http://127.0.0.1:<port>`. The document response's CSP header equals the ARCHITECTURE value.
6. **Markets.**
   - In `xm5-sg-cards` the main list shows only SGD offers, and the price summary reads "From <lowest listed SGD price> SGD · <n> Singapore offer(s)". "Other markets (may not ship to Singapore) · 1" is collapsed (`aria-expanded="false"`); expanding it by keyboard shows the USD offer.
   - In `no-market-offers` the main list reads "No Singapore offers found".
   - No converted amount appears anywhere.
7. **Research details.** Collapsed by default. When expanded, it lists every evidence item with its category label and the rejected count.
8. **History.** The frozen `evals/fixtures/history/mvp-history-xm5-sg.json` value, loaded into `kensaku.history.v1` unchanged before the first navigation:
   - renders as cards with the fallback image panel;
   - shows no specs or reason sections;
   - shows no history-reset notice and logs no error.

   A v1.1 run survives a reload with the same cards and image candidates.
9. **Accessibility.** Zero serious or critical axe violations in dark and light on `xm5-sg-cards` and `no-images`. Every disclosure and link is reachable and operable by keyboard. Image alt text follows REQ-013.

## Frontend quality (EV-007, amended)

Playwright, Chromium, fixture mode. The MVP's eight checks with v1.1 amendments (D-038). The full text replaces the MVP section, which is preserved at commit `2866477`:

1. **Primary journey.** Submit Q1's text.
   - Progress shows the four stages in order.
   - The comparison shows inline citations that link to the fixture's citation URLs.
   - (v1.1) The offer list in the product card shows merchant host, price with currency code, availability badge, retrieved time, and link.
   - Evidence appears in a separate, labeled section; (v1.1) that section is Research details.
   - The "last observed" price notice is visible.
2. **States.** Empty state with suggestions; running state with input disabled and a working cancel; no-offers state text; each `data-error` kind renders its specific message; partial results are labeled partial.
3. **History.** After a reload the conversation is restored. Clear history asks for confirmation, then empties the thread and removes `kensaku.history.v1`. Corrupted stored data shows the reset notice.
4. **Market.** Switching to SG or JP sends that market. (v1.1) That market's currency fills the card's main offer list, and other currencies move to Other markets. The choice survives reload.
5. **Accessibility.** `@axe-core/playwright` reports zero serious or critical violations on the empty, running, completed, and error states. The whole journey works with the keyboard only. Progress changes are announced through an ARIA live region. (v1.1) These run in the default dark theme; EV-010 and EV-015 cover light.
6. **Layout.** (v1.1) Replaces "the offer table remains readable": at 375 px width there is no horizontal page scroll, and the card layout checks in EV-015 check 1 apply.
7. **Secrets** (REQ-007). After the journey, no `localStorage` or `sessionStorage` value contains the test key. (v1.1) `kensaku.theme.v1` holds only `dark` or `light`.
8. **Component integrity.** `scripts/check-components.mjs` verifies that every file under `src/web/components/ui/` and `src/web/components/ai-elements/` matches the SHA-256 recorded in `components.lock.json` when the shadcn CLI installed it, and that `components.json` lists the `@ai-elements` registry. (v1.1) This includes `card`, `aspect-ratio`, `skeleton`, and `item`.

Owner review (human, recorded in `.futari/evidence/JM-105.md`): visual polish and readability of the v1.1 cards on desktop and mobile widths in both themes.

## CI and live checks

- Deterministic CI (`.github/workflows/ci.yml`, unchanged) runs on pull requests to `dev` and pushes to `dev`:
  - install, typecheck, lint;
  - `pnpm test` (EV-001 to EV-006, EV-009, EV-011 to EV-014, EV-017);
  - build;
  - `pnpm test:e2e` (EV-007, EV-010, EV-015);
  - harness and component check.
- Live checks never run in CI. They run locally with the owner's key. The MVP `pnpm live:acceptance` (EV-008) must not be run during v1.1; JM-106 removes its script.
- **Slice smoke (JM-104).** Q3 and Q4 from the v1.1 set, through the real app in live mode, at most 10 Exa requests in total (5 per query by construction).
  - Pass: each shows at least one SGD merchant offer, and at least one product image loads through the proxy.
  - BLOCKED: an Exa outage or exhausted credits.
  - FAIL: any other miss. It stops JM-104 and goes to the owner as a plan revision trigger; there is no rerun within this plan's budget.
- **EV-016 (JM-106).** `pnpm live:acceptance:v1-1`, under the budget and run rules in `live-acceptance-v1-1.json`.

## Live acceptance (EV-016)

- Runs Q1-Q8 in Chromium against the built app in live mode, with empty Exa and image caches. Limits: at most 5 requests per query, 40 per suite run, and $0.50 reported cost per run; at most 3 runs. The plan-wide cap of 130 requests and $1.50 governs. Reruns follow the run rules, and the last run decides.
- Pass rule (all of these, from the last run):
  - Offers:
    - at least 6 of 8 queries show a merchant offer;
    - at least 3 of the 4 SG queries (Q3, Q4, Q7, Q8) show an SGD offer in a card's main list;
    - at least 12 offers are displayed, and 100% pass revalidation;
    - owner audit failures are at most floor(10% of displayed offers);
    - 0 search or category pages are displayed as offers;
    - 0 fabricated offers.
  - Images:
    - at least 8 images are displayed;
    - at least 70% of offer-bearing cards, and at least 6 cards, show a loaded image;
    - 100% of displayed images pass revalidation (rules I1-I3 re-derived from the log);
    - owner image audit failures are at most max(1, floor(10% of displayed images)).
  - Run health:
    - 0 browser requests to non-local origins;
    - no unexpected error runs.
- Expected outcomes recorded in advance:
  - Q6 (Kindle, JP) is likely to show no offer (weak identifiers, R-21) and no image (I07); the 6-of-8 offer threshold allows two such queries.
  - The Logitech logo card that motivated the 1.8 aspect limit is now rejected by rule I3.
- Total live use during v1.1 execution: at most 130 Exa requests (10 smoke + 3 × 40) and $1.50 of reported cost, all from free credits. Additional spend: $0 (`liveEvaluationBudget.maxSpend = 0`). If Exa reports exhausted credits or a 402, live checks stop and the task records BLOCKED.

## Failure coverage

- MVP coverage unchanged.
- v1.1 classification:
  - one case per added list entry, path token, and currency symbol;
  - search hosts versus `research.` hosts;
  - percent-encoded and uppercase segments;
  - Shopify `collections` with and without `products`;
  - merchant blogs;
  - a bare `$`;
  - fractional yen with `￥`.
- Images:
  - every deny token, tokens in directory names, encoded file names, undecodable names, trailing slashes;
  - SVG, data and script URLs, credentials, 2048 and 2049 characters;
  - beacons, tiny or extreme or social-card aspect ratios, unreadable dimensions, exactly 5 MiB and one byte more, unsupported types, verdict precedence;
  - tier order, duplicates, the cap of 4;
  - 403 hosts, slow hosts, redirect chains, private and special addresses, IP-literal hosts, non-standard ports, DNS rebinding, cross-site embedding;
  - cache expiry, pruning, eviction, concurrency.
- Content: whitespace, empty, over-80, and duplicate specs; more than 5 specs; non-array specs; whitespace-only, malformed, and out-of-range-marker reasons.
- UI: no images, no market offers, real MVP history, both themes, keyboard-only use, 375 px width, storage unavailable.

## Frozen inputs

`protectedFiles` keeps every MVP frozen input and adds:
- `evals/cases/offer-classification-v1-1.json`, `image-selection.json`, `product-content.json`, `live-acceptance-v1-1.json`;
- the 12 new Exa fixtures (`V1`-`V10`, `R1-Q5`, `R1-Q6`) and the MVP history fixture;
- the amended `evals/harness.mjs`;
- the spike and probe scripts;
- the research note `research/v1-1-spike-2026-11-21.md`;
- the archived MVP contract.

Test files written during execution are not frozen, but they must load these inputs unchanged.
