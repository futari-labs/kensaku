# Kensaku

Kensaku is a local, single-user shopping research chat. Ask about a product in the US, Singapore or Japan. It shows a short comparison with numbered source citations, then, per product, only offers from direct merchant pages that Exa returned for that question. Prices stay in their original currency (USD, SGD, JPY) and are never converted or compared across currencies.

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

## Live acceptance (EV-008)

`pnpm live:acceptance` builds the app, starts the real server in live mode with an empty cache and ledger, posts the six queries in `evals/cases/live-acceptance.json` to `POST /api/chat`, and writes a run log and an owner audit sheet under `.futari/evidence/live/`. It spends real Exa credits (limits: 5 requests per query, 30 requests and $0.40 per run) and stops on a credit or authentication error.

```sh
EXA_ENV_FILE=/path/to/exa.env pnpm live:acceptance
```

Do not run it to experiment: the plan allows three suite runs in total.
