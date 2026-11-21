# Evaluation Plan

Status: proposed for approval with plan `kensaku-v1-1`. EV-001 to EV-007 and EV-009 carry over from `kensaku-mvp-v1`, with the amendments named below. EV-008 is retired: its run 1 log and audit stay in `.futari/evidence/live/` as history, and EV-016 replaces it. EV-010 to EV-017 are new.

## Traceability

| Eval | Requirements | Cases / fixture | Command | Pass rule |
| --- | --- | --- | --- | --- |
| EV-001 Merchant authenticity | REQ-003, REQ-016 | `evals/cases/offer-classification.json` (54, unchanged) plus the `supersedes` block of `offer-classification-v1-1.json` (L29, Y03) | `pnpm vitest run tests/evals/ev-001-merchant-authenticity.test.ts && node evals/harness.mjs --strict` | 54/54 with exactly L29 and Y03 replaced by their superseding labels; the test asserts the count and the two replaced ids; harness `--strict` exits 0. |
| EV-002 Product relevance | REQ-003 | MVP, unchanged | `pnpm vitest run tests/evals/ev-002-product-relevance.test.ts` | 100%: `irrelevant-product` exactly when labeled. |
| EV-003 Currency and ranking | REQ-004 | MVP, unchanged | `pnpm vitest run tests/evals/ev-003-ranking-currency.test.ts` | 4 cases and the property test pass. |
| EV-004 Citations | REQ-002 | MVP, unchanged (6 + 2 cases) | `pnpm vitest run tests/evals/ev-004-citations.test.ts` | All cases match; fixture pipeline runs use only this run's citations and result URLs. |
| EV-005 Spend guard and cache | REQ-006 | MVP scenarios plus one image scenario | `pnpm vitest run tests/evals/ev-005-spend-guard.test.ts` | MVP assertions pass; a fixture run that loads every product image leaves `RequestBudget.used` and the monthly ledger identical to the same run without image loads. |
| EV-006 Streaming and failure states | REQ-001, REQ-005 | MVP, unchanged | `pnpm vitest run tests/evals/ev-006-stream-failures.test.ts` | All MVP scenarios pass. |
| EV-007 Frontend quality | REQ-001, REQ-002, REQ-003, REQ-007, REQ-009, REQ-010 | Playwright, fixture mode | `pnpm exec playwright test tests/e2e/ev-007-frontend.spec.ts && node scripts/check-components.mjs` | "Frontend quality (EV-007, amended)" below; owner visual review of v1.1 recorded in `.futari/evidence/JM-104.md`. |
| EV-009 Local and key safety | REQ-007 | MVP plus image cache and CSP | `pnpm vitest run tests/evals/ev-009-key-safety.test.ts` | MVP assertions; key absent from `.cache/images/`; `GET /` carries the exact CSP from ARCHITECTURE; `/api/image/:id` with a foreign Host gets 403. |
| EV-010 Theme | REQ-011, REQ-010 | Playwright, fixture mode | `pnpm exec playwright test tests/e2e/ev-010-theme.spec.ts` | "Theme (EV-010)" below. |
| EV-011 Non-merchant pages and currency symbols | REQ-016, REQ-003 | `evals/cases/offer-classification-v1-1.json` (57: 41 live, 16 synthetic) | `pnpm vitest run tests/evals/ev-011-page-classification.test.ts` | 57/57 outcome and category; offers also currency and amount; asserts the case count. |
| EV-012 Product card content | REQ-012 | `evals/cases/product-content.json` (3 answers, 9 candidates) | `pnpm vitest run tests/evals/ev-012-product-content.test.ts` | Every candidate's `keySpecs` and resolved reason (or `null`) equal the labels; asserts the count. |
| EV-013 Product image selection | REQ-013 | `evals/cases/image-selection.json` (57 URL, 7 selection, 51 bytes cases) | `pnpm vitest run tests/evals/ev-013-image-selection.test.ts` | Every case equals its label; selection cases compare exact ordered `{imageUrl, pageUrl}` lists, classifying hits with `classifyHit` on the real fixtures; asserts each section's count. |
| EV-014 Image proxy safety and cache | REQ-014, REQ-007 | Injected resolver and fetcher; synthetic image bytes generated in the test | `pnpm vitest run tests/evals/ev-014-image-proxy.test.ts` | "Image proxy (EV-014)" below. |
| EV-015 Image-first product cards | REQ-012, REQ-013, REQ-015, REQ-009, REQ-010 | Playwright, fixture mode, scenarios with fixture images | `pnpm exec playwright test tests/e2e/ev-015-product-cards.spec.ts` | "Product cards (EV-015)" below. |
| EV-016 Live acceptance v1.1 | REQ-008, REQ-013, REQ-015, REQ-016 | `evals/cases/live-acceptance-v1-1.json` (8 queries) | `pnpm live:acceptance:v1-1` | "Live acceptance (EV-016)" below. |
| EV-017 Request contract | REQ-015, REQ-012 | Request builders | `pnpm vitest run tests/evals/ev-017-request-contract.test.ts` | For US, SG, JP the offer query is `"<brand> <name> price <market name> buy"` with matching `userLocation` and unchanged contents; the `/answer` `outputSchema` deep-equals ARCHITECTURE; the cache key differs from the MVP query's key. |

## Fixtures and provenance

- MVP fixtures (`evals/fixtures/exa-live/S1`-`S9`, `A1`-`A4`) are unchanged.
- `V1`-`V8`: real Exa responses from the v1.1 pre-approval spike (D-028), labeled `LIVE EXA RESPONSE`, with the exact request, timestamps, and status. `R1-Q5-offers-xm5` and `R1-Q6-offers-paperwhite` are byte-for-byte copies of two EV-008 run 1 search responses (provenance fields name the log and indexes). No credentials (harness scan and EV-009).
- Gold labels in the four v1.1 case files are **assistant-proposed**. They were computed by reference implementations of the written rules, which are independent of `src/`, and checked by hand. They become gold only through the owner's plan approval. For classification, the same reference implementation reproduces all 54 MVP labels under the MVP rules. Under the v1.1 rules only L29 and Y03 change, and both are recorded as supersessions.
- Non-obvious labels the owner approves with the plan:
  - N06: the Challenger collection page becomes evidence, not an offer.
  - N07: Mobyshop's USD price on an SG site stays a USD offer, shown under Other markets.
  - N08: Amazon SG `S$310` becomes an SGD offer.
  - N26, N27, N30: Bose listings are rejected as irrelevant because Exa's identifier "QuietComfort Headphones" is not contiguous in their titles (R-21, safe direction).
  - I07: no image for the Kindle in JP, because Amazon JP's only image is its logo.
  - L29, Y03: the supersessions.
- Synthetic cases (Z01-Z16, synthetic U and B cases) are marked synthetic.
- Fixture images under `tests/fixtures/images/` (created by JM-103) are synthetic, solid-colour images of known type and size, labeled synthetic. They exist so CI never fetches the internet and are never shown in live mode.
- Image bytes from the probe are not committed. The bytes cases record only the measured type, dimensions, and size.

## Harness and baseline

`node evals/harness.mjs` validates every frozen case file and fixture and reports each evaluation's readiness without running product code. Baseline on this planning branch, 2026-11-21:

```
HARNESS OK: 54 classification cases (40 live), 4 ranking cases, 6 citation cases (+2 spaced), 6 MVP live queries; v1.1: 57 classification cases (+2 supersessions), 3 content cases, 57/7/51 image url/selection/bytes cases, 8 live queries.
EV-001: READY (kensaku-v1-1 supersessions L29/Y03 pending JM-101)
EV-002 .. EV-007, EV-009: READY
EV-010, EV-012 .. EV-017: NOT RUNNABLE (product module or test does not exist)
EV-011: NOT RUNNABLE (test does not exist)
```

`node evals/harness.mjs --strict` fails until JM-101 makes the EV-001 test load `offer-classification-v1-1.json`. JM-101 lists it as a verification command. Default mode stays exit 0, so `dev` CI is green until then (the CR-001 pattern).

States stay distinct: **harness valid**, **not runnable** (product module or test file missing), **product assertion failing**, and **blocked** (an external dependency such as Exa, a merchant image host, or the browser runtime is unavailable). Only a run of the listed command produces PASS or FAIL. A merchant image host refusing a live fetch is an expected outcome measured by EV-016, not an error.

Tests for EV-001, EV-011, EV-012, and EV-013, and the EV-016 script, load their frozen case files directly. They may not copy, filter, or edit cases, and they assert the evaluated count. The harness fails a READY test file that does not reference its case file.

## AI quality

Kensaku still runs no model of its own. v1.1 adds two Exa-generated fields (key specs and reason) and one Exa-extracted field (the page image):

- Key specs and reasons are checked structurally: normalization and citation resolution in EV-012, the exact schema in EV-017. The owner judges their usefulness in EV-016 and product acceptance. No LLM judge is used.
- Image correctness cannot be decided by rules. Rules I1-I3 remove known junk, and EV-016's owner image audit measures the rest (threshold 90%). The spike's visual check found 18 of 20 rule-passing images correct; this is a sanity baseline, not a statistical guarantee (R-3, R-17).

## Theme (EV-010)

Playwright, Chromium, `pnpm start` in fixture mode:

1. **Default.** A fresh context (empty storage) emulating `prefers-color-scheme: light` loads the page: `<html>` has class `dark`, `getComputedStyle(document.documentElement).colorScheme` is `dark`, and the body background equals the computed `--background` of `.dark`.
2. **No flash.** With every request for the app's module bundle delayed by 2 s (Playwright route), the theme checks hold before the bundle runs: with empty storage, dark class and dark background; with `kensaku.theme.v1 = "light"`, no dark class and a light background.
3. **Toggle.** The header has a button with accessible name "Switch to light theme". Activating it with the keyboard (Tab to it, Enter) removes the dark class, stores `light`, and changes the name to "Switch to dark theme". A mouse click switches back and stores `dark`.
4. **Persistence.** After choosing light and reloading, the page is light. A new page in the same context is also light.
5. **Fallbacks.** A stored value of `"blue"` renders dark. With `localStorage` access throwing (init script), the page renders dark, the toggle still switches the current page, and no uncaught error is logged.
6. **Accessibility.** `@axe-core/playwright` reports zero serious or critical violations in both themes on the empty state, a completed `xm5-sg` run, and an error state.
7. **Theming convention.** The dark theme is applied only through the `dark` class on `<html>`; no element carries inline colour styles set by the theme code. Component integrity is checked by `scripts/check-components.mjs` (EV-007). JM-102's acceptance criteria, checked by its reviewer from the diff, cover "no CSS variable changed in `src/web/index.css`".

## Image proxy (EV-014)

Vitest against the Hono app factory, with an injected `lookup` and an injected upstream (no internet):

1. An unknown id, or an id that is not 64 lowercase hex characters, gets 404. The injected upstream receives no request.
2. A registered id whose host resolves to each of 127.0.0.1, 10.1.2.3, 172.16.0.1, 192.168.1.1, 169.254.169.254, 100.64.0.1, 0.0.0.0, ::1, fc00::1, fe80::1, and ::ffff:127.0.0.1 gets 502. No connection is attempted.
3. A public host that redirects to a private address gets 502. A chain of 4 redirects gets 502. A chain of 3 public redirects to a valid image succeeds.
4. The connection goes to the address the policy checked. When the injected resolver returns a public address first and a private one on a second lookup, the upstream receives the public address, and the second lookup is never used for that hop.
5. The upstream request has no `Cookie`, `Authorization`, or `Referer` header, and its `Accept` header is exactly as in ARCHITECTURE.
6. Bytes over 5 MiB get 502 and reading stops at the limit. An upstream that never finishes gets 502 within 8.5 s, measured with fake timers.
7. Generated images: a 400×300 JPEG, PNG, WebP, and AVIF are each served with the sniffed `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, and `Cache-Control: private, max-age=604800`. The upstream's own `Content-Type` (for example `text/html`) and `Set-Cookie` are ignored and never forwarded. A 1×1 GIF, an SVG document, a 150×400 PNG, and an 801×400 WebP each get 422.
8. Cache: a second request within 7 days is served from `.cache/images/` with no upstream request. After 7 days (fake clock) it refetches. A 422 verdict is reused for 24 hours.
9. Concurrency: 10 simultaneous requests for one id cause exactly 1 upstream request. Requests for 10 different ids never have more than 4 upstream requests in flight.
10. Guard: a foreign `Host` gets 403. A run's registration writes no key and no request header to `.cache/images/`.
11. Budget: serving images changes neither `RequestBudget.used` nor the Exa ledger.

## Product cards (EV-015)

Playwright, Chromium, `pnpm start` in fixture mode. Scenarios (JM-103 and JM-104 add them):
- `xm5-sg-cards`: SG market, 2 candidates; SGD offers plus one USD offer; image candidates mapped to fixture images, one of which fails rule I3.
- `xm5-us-cards`.
- `no-images`: every candidate fails.
- `no-market-offers`: SG market, USD offers only.
- `mvp-history`: a `kensaku.history.v1` entry saved by the MVP build.

1. **Layout.** At 1280×800 the first two cards share a top edge (±2 px), each is at least 480 px wide, and the image box is the card's content width at 4:3 and at least 360 px tall. At 375×812 the cards stack (each card's top is below the previous card's bottom), the image box is at least 250 px tall, and `document.scrollingElement.scrollWidth <= innerWidth`.
2. **Content order.** Each card's DOM order is: heading, image box with caption, price summary, specs list (at most 5 items), "Why it fits" reason with at least one inline citation, merchant offer list, Other markets disclosure (only when other-currency offers exist), Research details disclosure.
3. **Product versus merchant.** The card heading equals the candidate's brand and name and contains no merchant host. Each offer item shows the merchant host, merchant name, price with ISO code, availability badge, `<time>` retrieved, and a "View offer" link with an accessible name naming product and merchant.
4. **Images.**
   - While a delayed image loads, a skeleton is visible and the alt text is set.
   - The rule-I3-failing first candidate is skipped and the next one shows, with a caption naming that candidate's host and source title.
   - In `no-images`, each card shows "No verified product image" at the same box size, and no `img` element is in the `error` state.
5. **No third-party requests.** During every scenario, every browser request URL has origin `http://127.0.0.1:<port>`. The response's CSP header equals the ARCHITECTURE value.
6. **Markets.**
   - In `xm5-sg-cards` the main list shows only SGD offers, the price summary reads "From <lowest SGD amount> SGD · <n> Singapore offer(s)", and "Other markets (may not ship to Singapore) · 1" is collapsed (`aria-expanded="false"`). Expanding it by keyboard shows the USD offer.
   - In `no-market-offers` the main list reads "No Singapore offers found".
   - No converted amount appears anywhere.
7. **Research details.** Collapsed by default. When expanded, it lists every evidence item with its category label and the rejected count.
8. **History.** `mvp-history` renders as cards with the fallback image panel, without specs or reason sections, and without errors. A v1.1 run survives a reload with the same cards and image candidates.
9. **Accessibility.** Zero serious or critical axe violations in dark and light on `xm5-sg-cards` and `no-images`. Every disclosure and link is reachable and operable by keyboard. Image alt text follows REQ-013.

## Frontend quality (EV-007, amended)

The MVP checks 1-8 (Playwright, Chromium, fixture mode) remain, with these v1.1 amendments (D-038):

1. Primary journey: as in the MVP, except that offers are checked in the "offer list in the product card" instead of the offer table. The fields are unchanged: merchant host, price with currency code, availability badge, retrieved time, and link. Evidence appears in the labeled Research details section.
2. States: unchanged.
3. History: unchanged (MVP-saved history also renders; see EV-015 check 8).
4. Market: switching to SG or JP sends that market. That market's offers fill the main list, and other currencies move to Other markets. The choice survives a reload.
5. Accessibility: unchanged checks, now in the default dark theme (EV-010 and EV-015 cover light).
6. Layout: replaced by EV-015 check 1 (there is no offer table any more).
7. Secrets: unchanged, including `kensaku.theme.v1`, which holds only `dark` or `light`.
8. Component integrity: unchanged, covering the new `card`, `aspect-ratio`, `skeleton`, and `item` files.

Owner review (human, recorded in `.futari/evidence/JM-104.md`): visual polish and readability of the v1.1 cards on desktop and mobile widths in both themes.

## CI and live checks

- Deterministic CI (`.github/workflows/ci.yml`, unchanged) runs on pull requests to `dev` and pushes to `dev`: install, typecheck, lint, `pnpm test` (EV-001 to EV-006, EV-009, EV-011 to EV-014, EV-017), build, `pnpm test:e2e` (EV-007, EV-010, EV-015), harness, and component check. The CI workflow runs `node evals/harness.mjs` without `--strict`. Task verification commands run `--strict` locally and in evidence once JM-101 lands.
- Live checks never run in CI. They run locally with the owner's key:
  - Slice smoke (JM-103): Q3, Q4, and Q1 from the v1.1 set, at most 10 requests.
  - EV-016 (JM-105): `pnpm live:acceptance:v1-1`, under the budget and run rules in `live-acceptance-v1-1.json`.

## Live acceptance (EV-016)

- Runs Q1-Q8 in Chromium against the built app in live mode, with empty Exa and image caches, at most 5 requests per query, 40 per suite run, and $0.50 reported cost per run. At most 3 runs; reruns follow the run rules, and the last run decides.
- Pass rule (all of these, from the last run):
  - Offers:
    - at least 6 of 8 queries show a merchant offer;
    - at least 3 of the 4 SG queries (Q3, Q4, Q7, Q8) show an SGD offer in a card's main list;
    - 100% of displayed offers pass revalidation;
    - at least 90% of displayed offers pass the owner audit;
    - 0 search or category pages are displayed as offers;
    - 0 fabricated offers.
  - Images:
    - at least 70% of cards with an offer show a loaded image;
    - 100% of displayed images pass revalidation (rules I1-I3 re-derived from the log);
    - at least 90% of displayed images pass the owner image audit.
  - Run health:
    - 0 browser requests to non-local origins;
    - no unexpected error runs.
- Total live use during v1.1 execution: at most 130 Exa requests (10 smoke + 3 × 40) and $1.50 of reported cost, all from free credits. Additional spend: $0 (`liveEvaluationBudget.maxSpend = 0`). If Exa reports exhausted credits or a 402, live checks stop and the task records BLOCKED.

## Failure coverage

- MVP coverage unchanged.
- v1.1 classification boundaries:
  - search hosts versus `research.` hosts;
  - `/s/`, `/search`, `/category/`, percent-encoded paths;
  - Shopify `collections` with and without `products`;
  - merchant blogs;
  - marketplace subdomains;
  - currency symbols, including a bare `$` and fractional yen with `￥`.
- Images:
  - junk file names, SVG, data and script URLs, credentials, overlong URLs;
  - beacons, tiny or extreme aspect ratios, oversize bytes, unsupported types;
  - 403 hosts, slow hosts, redirect chains, private addresses, DNS rebinding;
  - cache expiry, concurrency.
- UI:
  - no images, no market offers, MVP history;
  - both themes, keyboard-only use, 375 px width;
  - storage unavailable.

## Frozen inputs

`protectedFiles` keeps every MVP frozen input and adds:
- `evals/cases/offer-classification-v1-1.json`, `image-selection.json`, `product-content.json`, `live-acceptance-v1-1.json`;
- the 10 new fixtures (`V1`-`V8`, `R1-Q5`, `R1-Q6`);
- the amended `evals/harness.mjs`;
- the spike and probe scripts;
- the research note `research/v1-1-spike-2026-11-21.md`;
- the archived MVP contract.

Test files written during execution are not frozen, but they must load these inputs unchanged.
