# Kensaku

Kensaku is a local, single-user shopping research chat. Ask about a product in the US, Singapore or Japan. It shows a short comparison with numbered source citations, then one card per product: a product image, key specifications, why it fits, and only offers from direct merchant pages that Exa returned for that question. Prices stay in their original currency (USD, SGD, JPY) and are never converted or compared across currencies.

## What you see

- **Theme.** A toggle switches between dark and light. The choice is stored in the browser (`kensaku.theme.v1`) and applied before the first paint; with no stored choice (or no storage) the page is dark.
- **Market.** Pick US, Singapore or Japan before asking. The market is stored in the browser and decides the search (see below) and which offers lead a card.
- **Cards.** Each card shows the product image, the lowest price in the market's currency with the number of offers, up to five key specifications and a cited reason (both from Exa's answer, never edited), then the offers. Offers in the market's currency sit in the main list; offers in other currencies wait under "Other markets (may not ship to ...)". "Research details" lists pages that were kept as evidence, not as offers, and how many results were rejected.
- **Images.** An image is a product photo that Exa returned for a page Kensaku already accepted: first a merchant offer in your market, then a manufacturer page, then any other merchant offer, at most four candidates per product. The card shows the first candidate that loads and names its source host in the caption. When none loads, the card says "No verified product image". Images are never generated or searched for separately.
- **Image proxy.** The browser never contacts a merchant. It asks `GET /api/image/:id` on this server, which fetches only image URLs that a run on this machine registered, over `http`/`https` on ports 80 and 443 to public addresses only, with at most 3 redirects and an 8 s limit. It accepts JPEG, PNG, WebP or AVIF up to 5 MiB, at least 200 px on the shorter side and with a width-to-height ratio from 0.5 to 1.8, judging the bytes, not the reported type. Accepted images are cached on disk in `.cache/images/` (served for 7 days, then refetched); delete the folder at any time. The page's Content-Security-Policy allows only this origin.

## Market-aware search

The selected market is sent to Exa with every request. The answer call carries it as `userLocation`, and each offer search is worded for the market (for example "... price Singapore buy") and sent with the same `userLocation`, so a Singapore question finds Singapore retailers. A result is still an offer only if it passes the model-identity and direct-merchant rules below.

## Setup

Requirements: Node.js 22.18 or newer, pnpm 10, and an Exa API key (the free plan is enough; no payment method).

```sh
pnpm install
cp .env.example .env.local   # then put your key after EXA_API_KEY=
```

`.env.local` is ignored by git. To keep the key elsewhere, point `EXA_ENV_FILE` at the file:

```sh
EXA_ENV_FILE=/path/to/exa.env pnpm start
```

`EXA_ENV_FILE` must exist when set. Without it, the server reads `.env.local` if present. The key is read only by the server process, is never sent to the browser, and is never logged.

## Run

```sh
pnpm start      # builds the web app, then serves it and the API at http://127.0.0.1:8787
pnpm dev        # Vite dev server with the API, for development
```

The server listens on `127.0.0.1` only. Set `KENSAKU_PORT` to use another port.

## Limits

- At most 5 Exa requests per question (usually 3: one answer call, a search for each of the first two candidates, and a search for a third only when neither had an offer).
- Repeated questions within 6 hours are served from `.cache/` with their original retrieval time and no request.
- Monthly limits, stored in `.cache/ledger`: 400 requests and $8 of reported cost (`KENSAKU_MONTHLY_REQUEST_LIMIT`, `KENSAKU_MONTHLY_COST_LIMIT`). Exa's exhausted-credit response also stops live calls.
- Each answer shows the run's Exa requests, cache hits and reported cost, and the month's usage.
- One research run at a time.
- Images add no Exa request or cost. Image fetches are limited to 4 at once, and their results are cached separately from Exa's.
- Exa's answer sometimes ends in leaked structured output. Text from the first `{` or `}` on is cut, and the card or comparison says so.

## Data caveats

- Prices, currencies and availability are what Exa extracted from a page at the time shown ("retrieved"), not a live feed. They can be stale or wrong; check the merchant page before buying.
- An offer must be a direct merchant product page, in the run's search results, that matches the product's model identity. Pages that fail that test (aggregators, reviews, pages without a price) appear only as labeled evidence.
- Only US/USD, SG/SGD and JP/JPY are supported. Other currencies are not shown as offers.
- The comparison text comes from Exa's answer. Markers like `[1]` or `[1, 2]` link to the cited sources; a marker that points at no source is removed, and a paragraph with no valid citation is flagged as uncited.
- Shipping, tax, coupons and seller reputation are not modelled.

## Checks

```sh
pnpm typecheck && pnpm lint && pnpm test      # unit, evaluation and server tests (no network)
pnpm test:e2e                                  # browser tests against fixture data
node evals/harness.mjs --strict                # frozen evaluation cases are valid and loaded
```

## Live acceptance (EV-016)

`pnpm live:acceptance:v1-1` builds the app, starts the real server in live mode with an empty Exa cache and an empty image cache, and drives the eight queries in `evals/cases/live-acceptance-v1-1.json` through the page in Chromium (select the market, type the question, wait for the answer). It spends real Exa credits and stops on a credit or authentication error.

```sh
EXA_ENV_FILE=/path/to/exa.env pnpm live:acceptance:v1-1
```

- Limits: 5 requests per query, 40 requests and $0.50 per run, and 130 requests and $1.50 across the JM-104 smoke and every run. It reads the committed logs first and refuses a query whose worst case would not fit, or when less than $0.05 remains. Do not run it to experiment: at most three runs are allowed, and a rerun needs a recorded fix or an outage.
- It writes `.futari/evidence/live/ev-016-run-<n>-<time>.json` (every Exa request and cost, every displayed offer with its list, every displayed image with its candidates and the proxy's answers, truncations, the browser's request origins, totals) after each query, before anything is derived from it, and `ev-016-run-<n>-audit.md`, the owner's audit sheet.
- Displayed image bytes and full-page screenshots go to `$KENSAKU_AUDIT_DIR` (default: the system temp folder), never into the repository.
- It exits non-zero when a deterministic threshold fails or the run stopped early. The owner-audit thresholds are filled in from the audit sheet.

The MVP command `pnpm live:acceptance` (EV-008) is history and no longer exists.
