# Kensaku

Kensaku is a local, single-user shopping research chat. Ask about a product in the US, Singapore or Japan. It shows a short comparison with numbered source citations, then one card per product: a product image, key specifications, why it fits, and only offers from direct merchant pages that Exa returned for that question. Prices stay in their original currency (USD, SGD, JPY) and are never converted or compared across currencies. You can add an offer to a simulated cart and pay for it in a Stripe sandbox; no merchant order is placed and no real money moves (see "Simulated checkout").

## What you see

- **Theme.** A toggle switches between dark and light. The choice is stored in the browser (`kensaku.theme.v1`) and applied before the first paint; with no stored choice (or no storage) the page is dark.
- **Market.** Pick US, Singapore or Japan before asking. The market is stored in the browser and decides the search (see below) and which offers lead a card.
- **Cards.** Each card shows the product image, the lowest price in the market's currency with the number of offers, up to five key specifications and a cited reason (both from Exa's answer, never edited), then the offers. Offers in the market's currency sit in the main list; offers in other currencies wait under "Other markets (may not ship to ...)". "Research details" lists pages that were kept as evidence, not as offers, and how many results were rejected.
- **Cart.** "Add to cart" on an offer in the market's currency puts it in the "Simulated cart" sheet, which keeps one currency at a time and shows each line's "Demo checkout price" apart from the "Last observed" merchant price with its host and time. Checkout opens a Stripe-hosted page (see "Simulated checkout"). The order list in the sheet shows each order as "Simulated · Open", "Paid", "Cancelled" and so on.
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

## Simulated checkout (Stripe sandbox)

Checkout is a simulation. Paying creates a Stripe **sandbox** Checkout Session and nothing else: no order is placed with any merchant, nothing ships, and no real money moves. The price you pay is a "demo checkout price" copied from the last-observed price on the merchant page, which can be stale. Every Stripe line item is named "Simulated: ..." and says so in its description. An order becomes paid only when Stripe's signed webhook (`checkout.session.completed` or `checkout.session.async_payment_succeeded`) reaches this server; arriving back on the return page never marks it paid.

Only offers that a research run on this machine registered can be added, and the server prices them from that registration, not from anything the browser sends. The cart and orders live on the server in `.data/commerce/` (ignored by git).

### One-time setup (you, in your own Stripe account)

Checkout stays off, and the cart still works, until both secrets below are set. Live keys are refused: the server will not start with a `STRIPE_SECRET_KEY` that is not a sandbox key.

1. Have a Stripe account with a **sandbox** (Dashboard, sandboxes). Never use live mode.
2. If the Stripe CLI requires it, enable CLI access for the sandbox (Settings, Team and security, MCP and CLI access).
3. Install the Stripe CLI (`brew install stripe`, or Stripe's install script) and run `stripe login`, choosing the sandbox, not live access.
4. Create a sandbox secret key, or a restricted key with Checkout Sessions read and write, and put it in `.env.local` as `STRIPE_SECRET_KEY=` (it must start with `sk_test_`, `rk_test_` or `rkcs_test_`).
5. Run `stripe listen --print-secret` once and put the `whsec_...` value in `.env.local` as `STRIPE_WEBHOOK_SECRET=`. The server verifies every webhook with it, so it must be the secret of the same sandbox and CLI login you use below.

Keys and secrets are read only by the server process, are never sent to the browser, and are never logged.

### Each time you use checkout

Open two terminals in the repository.

```sh
# Terminal 1: forwards Stripe's test events to the server
stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed --forward-to http://127.0.0.1:8787/api/stripe/webhook

# Terminal 2
pnpm start
```

Then open **http://127.0.0.1:8787** and use Kensaku there, started with `pnpm start`. Do not use `localhost:8787` or `pnpm dev`: Stripe sends you back to `http://127.0.0.1:8787`, which is a different browser origin from `localhost`, so a page opened elsewhere would not be the one Stripe returns to (the cart and orders still exist on the server, but the browser's own state would not carry over). Without `stripe listen` running, a payment succeeds on Stripe's page but Kensaku never learns of it and the order stays open until it expires.

On the Stripe-hosted page use a test card with any future expiry and any CVC:

- `4242 4242 4242 4242`: payment succeeds (if SGD or JPY refuses it, use `4000 0070 2000 0003` for Singapore or `4000 0039 2000 0003` for Japan).
- `4000 0000 0000 0002`: the card is declined. Use the page's back link to return to Kensaku, which cancels the checkout and keeps your cart.
- The back link without paying also cancels the checkout and keeps the cart.

Starting a second checkout expires the first one's session. An unpaid checkout expires after an hour.

### Reset

Stop the server, delete `.data/commerce/`, and start it again to clear the cart, orders and processed webhook ids. Registered offers live in `.cache/offers/` and expire after 30 days.

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

## Live sandbox acceptance (EV-023)

`pnpm live:acceptance:v1-2` runs the checkout acceptance in `evals/cases/live-acceptance-v1-2.json` against the real server, your Stripe sandbox and Exa. It spends real Exa credits and needs you at the Stripe-hosted page for scenarios A1 to A5. It builds and starts nothing, so start the pieces yourself first:

```sh
# Terminal 1: stripe listen as above
# Terminal 2: an empty .data/commerce/, then the server with its output saved
rm -rf .data/commerce && mkdir -p .cache/live && pnpm start 2>&1 | tee .cache/live/ev023-server.log
# Terminal 3
pnpm live:acceptance:v1-2 --server-log .cache/live/ev023-server.log
# After the owner's H1 to H5 answers are in the audit sheet
pnpm live:acceptance:v1-2 --finalize-audit .futari/evidence/live/ev-023-run-<n>-<UTC>.json
```

`pnpm live:acceptance:v1-2 --dry-run` runs the whole flow against a fake port and fixture research. It uses no network and writes no file. It reads the committed logs in `.futari/evidence/live/` to compute plan-wide Exa usage.

### Preconditions

The script checks these and stops before any Exa request, and before it reserves a run, when one fails:

- The loaded `STRIPE_SECRET_KEY` starts `sk_test_`, `rk_test_` or `rkcs_test_`.
- `STRIPE_WEBHOOK_SECRET` equals `stripe listen --print-secret`.
- One `stripe listen` process line forwards to `http://127.0.0.1:8787/api/stripe/webhook`, subscribes to all five frozen events, and has no `--live`. Each process line is judged alone. The script prints the matching and non-matching lines with secrets redacted.
- The `--server-log` file holds this server's `listening` line with port 8787 and mode `live`.
- The server answers at `127.0.0.1:8787` in live mode with an Exa key and checkout configured.
- The `--server-log` file is written by that server. The script sends one harmless request (a cart removal of an offer that is not there), then requires a new `cart` line in the file within 5 seconds. A stale file, or one from another server, is refused.
- `.data/commerce/` is empty.
- The plan-wide Exa budget has room for one more attempt.

### What a run does

The script researches Q1, Q3 and Q5. Each attempt may use at most 5 Exa requests, and each query gets one re-ask. A research attempt that fails for any reason other than exhausted credits or a budget refusal (a non-200 answer from `/api/chat`, a fetch error, a stream with no products) is re-asked once. If it fails again, the run is FAIL, not BLOCKED, and the scenarios that needed that query are recorded as not run because of the research failure. The script prints the Stripe page URL and the steps for each owner scenario, then waits for the order to leave "open" (20 minutes by default, `--timeout-minutes`). It then checks the outcome and retrieves the session from Stripe as an audit. Scenarios A6 to A8 (a resent event, two checkouts in a row, forged webhook bodies) run on their own. The script never clicks anything on the Stripe page.

Each scenario kind has a fixed list of gating checks that all start false. A check that never ran counts as failed, so an order the script cannot read after your step fails the scenario.

### Exa budget

The plan allows 30 Exa requests and $0.40 of reported cost in total, and 25 requests for EV-023. Plan-wide usage is the larger of two figures: the local counter `.cache/live/v1-2-exa-counter.json`, and the sum recovered from the committed logs in `.futari/evidence/live/`. The recovered sum counts the JM-203 smoke as 3 requests at a bound of $0.06 (3 x $0.02, the most one request may cost), because that run did not record its cost. It adds the requests and cost of every `ev-023-run-*` log, including started and aborted ones.

The script refuses an attempt when its worst case would pass a cap. The worst case is 5 requests and $0.10, taken from the server's own limits (5 requests per run, at most $0.02 per request). A failed request, or a run with no cost in its usage data, counts at the worst case, never as zero. The script adds the worst case to the counter and to the run's started log before each attempt, then replaces it with the actual spend when the attempt returns, so an interrupted attempt still counts. The script stops research on an HTTP 402 or a `credits_exhausted` error, and on the server's own monthly limit. The remaining scenarios are then BLOCKED.

### Verdicts and exit codes

| Verdict | Meaning | Run exit code |
| --- | --- | --- |
| `PENDING_AUDIT` | Every automatic check passed. The owner's H1 to H5 answers are still missing. | 0 |
| `FAIL` | A scenario, a research check or a threshold failed, research kept failing after its re-ask, or the run aborted. | 1 (2 when aborted) |
| `BLOCKED` | No check failed, but a scenario could not run, for example no addable offer after the re-ask, or exhausted credits. The owner decides. | 3 |
| `PASS` | All checks passed and every H answer is `yes`. Only `--finalize-audit` prints it. | not applicable |

The case file may list `blockedAllowances` (CR-006). An allowance covers a BLOCKED scenario only when research finished both permitted asks for its query and the last ask's validated data holds no merchant offer in the market currency. The run log records that count on the scenario (`allowance`) and the per-product outcome of each query (`products`: ids, counts and categories, never URLs or titles), and the thresholds name the allowance used (`blockedAllowancesUsed`). A scenario blocked for any other reason, such as a budget refusal or exhausted credits, is not covered. The run log never copies scenario instructions, card numbers, preconditions or other free text from the case file.

A live run that exits 0 is not acceptance. Acceptance is the moment `--finalize-audit` prints `PASS`. The command reads the audit sheet, where each answer must be exactly `yes` or `no` (case and trailing punctuation do not matter), and anything else stays pending. It exits 0 for `PASS`, 3 for `BLOCKED` and 1 otherwise. Exit code 2 also means the script stopped before the run started.

### Run logs

Once the preconditions pass, and before any Exa request, the script writes `.futari/evidence/live/ev-023-run-<n>-<time>.json` with status `started`. That file counts as a run, so a crash or Ctrl-C never frees a third run (at most 2 are allowed). The started log carries the run's current Exa totals and is rewritten whenever they change. The final log replaces it. If anything throws late, the log still gets written with status `aborted` and the error in its notes. A leak-scan hit does not drop the log. The script writes a scrubbed copy and says why. The script also writes `ev-023-run-<n>-audit.md`, an empty sheet for your answers to the five audit questions.
