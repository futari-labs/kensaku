# Architecture

Status: proposed for approval with plan `kensaku-mvp-v1`. Evidence: `docs/futari/research/exa-2026-11-21.md` (Exa capabilities and the 12-request live spike) and `docs/futari/research/references-2026-11-21.md` (reference projects, AI Elements).

## Chosen design

One TypeScript package, managed with pnpm, that runs on the owner's machine:

```
Browser (127.0.0.1)                         Node 22 process (127.0.0.1:8787)
┌──────────────────────────────┐   POST     ┌──────────────────────────────────────────┐
│ src/web  React 19 + Vite     │ /api/chat  │ src/server  Hono                          │
│  AI Elements + shadcn/ui     │──────────▶ │   host/origin guard, request parsing      │
│  @ai-sdk/react useChat       │◀────────── │   UI message stream (ai createUIMessage-  │
│  localStorage history        │  UI msg    │   Stream): progress, text, sources, data  │
└──────────────────────────────┘  stream    │        │                                  │
                                            │ src/research/pipeline.ts  (fixed stages)  │
                                            │        │ uses                             │
                                            │ src/core  pure rules: classify, identity, │
                                            │           currency, rank, citations       │
                                            │ src/exa   ExaPort ── exa-js SDK ──▶ api.exa.ai
                                            │           RequestBudget, cache, ledger    │
                                            │           (.cache/ on disk, gitignored)   │
                                            └──────────────────────────────────────────┘
```

| Module | Responsibility | State it owns |
| --- | --- | --- |
| `src/core/` | Pure functions and types: offer classification, product identity, currency rules, ranking, citation resolution, URL canonicalization. No I/O. | None |
| `src/exa/` | `ExaPort` interface; `ExaSdkPort` (the only importer of `exa-js`); `FixtureExaPort` for tests; `RequestBudget`; disk cache; monthly usage ledger; error mapping. | `.cache/exa/*.json`, `.cache/ledger/YYYY-MM.json` |
| `src/research/` | `runResearch(question, market, port, signal)` runs the fixed stage sequence and yields typed `RunEvent`s. | One run's in-memory state |
| `src/server/` | Hono app: `POST /api/chat`, `GET /api/usage`, `GET /api/health`, static files for the built web app. Converts `RunEvent`s to the AI SDK UI message stream. Binds 127.0.0.1 only. | None beyond the request |
| `src/web/` | React app composed from unmodified AI Elements and shadcn/ui components; Kensaku-owned compositions in `src/web/app/`. | `localStorage` keys `kensaku.history.v1`, `kensaku.market.v1` |

Why this shape: Kensaku is a single-user local tool, so one process and one package is the simplest thing that meets every requirement. Business rules sit in `src/core` as pure functions, so the frozen evaluation cases test them directly without network or UI.

## Research pipeline

A fixed procedure, not an open-ended agent loop (adopted from the Aria Labs and ShopSense references). Each run:

1. **Cache lookup.** Key = SHA-256 of `{endpoint, normalized request body, market}`. A hit returns the stored response with its original `receivedAt` and costs no request. TTL 6 hours.
2. **Stage `candidates` (1 request).** `exa.answer(question, { outputSchema })` with schema `{ comparison: string, candidates: [{ name, brand, modelIdentifiers[] }] (max 3) }` and the market's `userLocation`. Spike A2 confirmed this returns cited comparison text plus candidates in one $0.005 call.
3. **Stage `offers` (1 request per candidate).** For the first 2 candidates by default, at most 3: `exa.search("<brand> <name> buy", { type: "auto", numResults: 8, userLocation, contents: { highlights: true, summary: { query, schema: OfferSummarySchema } } })`. `OfferSummarySchema` is the spike's schema: `isProductListing`, `productName`, `merchant`, `price`, `currency`, `availability`. About $0.015 per call.
4. **Stage `validate` (no request).** `src/core` classifies every result as a merchant offer, labeled evidence, or rejected (rules below), then ranks offers.
5. **Stage `compare` (no request).** Resolves the comparison's `[n]` markers against the answer's citations.

Request count: normal question = 1 + 2 = 3 (meets the 1-3 target). Maximum = 1 + 3 candidates + 1 retry = 5. `RequestBudget(5)` issues one token per Exa call; `ExaSdkPort` cannot call the SDK without a token, so a sixth call is impossible by construction (EV-005). Cache hits consume no token.

Retries: one retry for HTTP 429 (honouring `Retry-After` up to 5 s), 5xx, or timeout, only if a budget token remains. Timeout 30 s per Exa call, 90 s per run. Client cancel aborts the in-flight call through `AbortSignal`.

## Offer classification

Applied in this order to each search result; the first matching rule decides. `URL` means the result's URL.

1. URL is not `http(s)` → **rejected: invalid-url**.
2. URL is not one of this run's Exa result URLs → **rejected: url-not-from-run** (offers can never come from synthesized text; spike L6).
3. Product identity fails (below) → **rejected: irrelevant-product** (spike L1).
4. Host is on the aggregator list (`src/core/hosts.ts`: kakaku.com, product.rakuten.co.jp, bestpricescanner.com, deal.ai, idealo.*, pricespy.*, google.com/shopping, camelcamelcamel.com, shopsavvy.com) → **evidence: aggregator**.
5. Host is on the editorial list (theverge.com, howtogeek.com, rtings.com, soundguys.com, techradar.com, whathifi.com, wirecutter / nytimes.com, cnet.com, engadget.com, tomsguide.com, pcmag.com) → **evidence: editorial**.
6. `isProductListing !== true` → **evidence: not-a-listing**.
7. Price invalid → **evidence: merchant-no-price** (D-015). Valid means: a finite number > 0; currency, after trim and uppercase, is a 3-letter ISO 4217 code; USD and SGD at most 2 decimal places; JPY an integer.
8. Currency not in {USD, SGD, JPY} → **rejected: unsupported-currency** (D-014).
9. Merchant/host consistency fails → **evidence: merchant-mismatch** (spike L3). Normalize the extracted merchant with NFKC, lowercase, remove punctuation, split into tokens, drop stopwords (`com co net jp sg us www store shop online official singapore japan usa inc ltd the`) and tokens under 3 characters. If any Latin-script tokens remain, at least one must be a substring of some host label (host split on `.` and `-`). If none remain (for example a Japanese name), the check is skipped (RISKS R-7).
10. Otherwise → **merchant offer**.

Offer fields: `merchantHost` (from the URL, displayed as the merchant), `merchantName` (extracted, shown secondary), `canonicalUrl`, `price {amount, currency}`, `availability` (`in_stock | out_of_stock | preorder | unknown`; any other value becomes `unknown`), `source: "exa"`, `retrievedAt` (Kensaku's receipt time of the Exa response; spike L5 showed Exa provides no observation time), `exaRequestId`, `productName`.

URL canonicalization removes `utm_*`, `tag`, `linkCode`, `linkId`, `ref`, `ref_`, `psc`, `gclid`, `fbclid` and keeps all other parameters in their original order. Kensaku adds no affiliate parameters.

Evidence items keep `url`, `title`, `host`, `category`, and any reported price, which the UI labels "reported by <host>; not a merchant offer".

## Product identity

Identity text = the summary's `productName`, falling back to the result title. Normalize with NFKC and lowercase, then split on non-alphanumeric characters into tokens. Each candidate `modelIdentifier` is normalized and tokenized the same way. An identifier is usable if its joined form has at least 4 characters and it either contains a digit or has 2 or more tokens. A result matches if any usable identifier equals the concatenation of some run of consecutive tokens in the identity text. So `WH-1000XM5` matches "WH 1000XM5" and "WH-1000XM5/LME", but not "WH-1000XM4". `MX Master 3` does not match "MX Master 3S" (EV-002 cases Y06, Y07). A candidate with no usable identifier gets no offers.

## Ranking

Defined in `evals/cases/ranking-currency.json` `rule`: group by currency; market currency first, then USD, SGD, JPY; within a group order by availability rank, amount ascending, merchant host, canonical URL; duplicate canonical URLs collapse to the first received. No arithmetic or comparison ever crosses currency groups, and there is no exchange-rate data (D-014).

## Citations

Defined in `evals/cases/citations.json` `rule`. Markers resolve 1-based into the `/answer` citations; out-of-range markers are removed and counted; paragraphs with no resolved marker are flagged "uncited" in the UI. Source links rendered with `inline-citation` and `sources` are exactly the resolved citation URLs.

## Interfaces and data

`POST /api/chat`. Request: AI SDK `useChat` body `{ messages: UIMessage[], market: "US" | "SG" | "JP" }`, parsed with zod at the boundary. Only the last user message's text is researched; earlier turns are display history. Response: `createUIMessageStreamResponse` with these parts:

| Part | Payload |
| --- | --- |
| `data-progress` | `{ stage: "candidates" \| "offers" \| "validate" \| "compare", status: "running" \| "done" \| "failed", detail? }` |
| `text` | Comparison text with resolved markers |
| `source-url` | One per resolved citation |
| `data-products` | `[{ candidate, offerGroups: [{ currency, offers[] }], evidence[], rejectedCounts }]` |
| `data-usage` | `{ exaRequests, cacheHits, costDollars, monthRequests, monthLimit }` |
| `data-error` | `{ kind: "auth" \| "credits_exhausted" \| "monthly_limit" \| "rate_limited" \| "upstream" \| "timeout" \| "cancelled" \| "invalid_request", message, partial: boolean }` |

`GET /api/usage` returns the ledger for the current month. `GET /api/health` returns `{ ok, exaConfigured, mode }`, never the key.

Run states: `running → completed | failed | cancelled`. A run that fails after the candidates stage ends `failed` with `partial: true`, and the products it already validated stay visible and labeled partial.

History (D-016): the client stores `{ version: 1, messages, savedAt }` in `localStorage["kensaku.history.v1"]` after each completed or failed run, validated with zod on load. Invalid or newer-version data is discarded with a visible notice. "Clear history" opens an `alert-dialog` and removes the key. The server stores no conversation.

## Spend guard and usage ledger

- Per run: `RequestBudget(5)` (D-017).
- Per month: `.cache/ledger/YYYY-MM.json` `{ requests, costDollars, exhaustedAt? }`, written atomically (temporary file plus rename) behind an in-process mutex. Limits: `KENSAKU_MONTHLY_REQUEST_LIMIT` (default 400) and `KENSAKU_MONTHLY_COST_LIMIT` (default 8.00 dollars, under the $10 monthly free credit). When either would be exceeded the run fails with `monthly_limit` before calling Exa.
- Exa HTTP 402, or any error whose message matches credit/quota/billing text, sets `exhaustedAt`; all live calls stop until the owner deletes the ledger file or the month changes. The UI explains this.
- Every Exa response's `costDollars.total` is added to the ledger and to the run's usage part.

## Dependencies and evidence

| Dependency | Version observed | Evidence |
| --- | --- | --- |
| exa-js | 2.29.0 | SDK types read; 12 live calls (research note) |
| ai / @ai-sdk/react | 7.0.178 / 4.0.182 | `createUIMessageStream`, `source-url` and `data-*` parts verified in package types |
| hono / @hono/node-server | 4.13.19 / 2.1.11 | npm |
| react / vite / tailwindcss | 19.3.1 / 8.3.8 / 4.3.5 | npm |
| shadcn CLI | 4.23.0 | shadcn MCP resolved `@shadcn` items |
| AI Elements | registry.ai-sdk.dev, 30 components | registry JSON read |
| vitest / @playwright/test / @axe-core/playwright | 5.1.1 / 1.65.1 / 4.14.0 | npm |
| zod / typescript | 4.6.7 / 7.0.2 | npm |

JM-001 pins exact versions in `package.json` and commits `pnpm-lock.yaml`. If a version above fails to install or build together, JM-001 may choose the nearest working release and must record it in its evidence; this is not a plan change unless an API used by this architecture disappears.

## Operations

- Start: `pnpm dev` (Vite on 127.0.0.1:5173 proxying `/api` to Hono on 127.0.0.1:8787) or `pnpm start` (build, then Hono serves the web build and API on 127.0.0.1:8787).
- Secrets: the server reads `EXA_API_KEY` with `process.loadEnvFile` from `.env.local`, or from the path in `EXA_ENV_FILE` (so a worktree can use the main checkout's file without copying it). The key never appears in the client bundle (no `VITE_` variable), logs, cache files, fixtures, or responses (EV-009).
- Network: the server binds to `127.0.0.1` and refuses to start on any other host. It rejects requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding guard), and rejects a `POST` whose `Origin` is present and not same-origin.
- Modes: `KENSAKU_EXA_MODE=live` (default) or `fixture`. Fixture mode is accepted only when `NODE_ENV=test`. In fixture mode the UI shows a persistent "Fixture data" banner. There is no silent fallback from live to fixtures; Kensaku fails closed (ShopSense reference).
- Observability: one JSON log line per stage and per Exa call to stdout: run ID, stage, request count, cache hit, cost, duration, error kind. Query text is logged locally; the key and request headers never are.
- No deployment, auth, or remote storage (D-010).

## Alternatives and decisions

| Option | Decision | Reason |
| --- | --- | --- |
| Exa Connect Affiliate.com structured catalog | Rejected | Pay-as-you-go only; violates D-005 (research F7, F8). |
| Exa Agent runs per question | Rejected | $0.012-$1.00 per run and seconds-to-minutes latency; the fixed pipeline costs about $0.035 per run. |
| Search `outputSchema` offer lists | Rejected | Spike L6: assigned other merchants to an aggregator URL. Per-result summaries tie each offer to one URL. |
| Next.js | Rejected | Server rendering and routing are unnecessary for a local single-page tool; Vite plus Hono is smaller. |
| SQLite or server-side history | Rejected | `localStorage` meets D-016 for one local user. |
| Anthropic or OpenAI reasoning | Rejected | D-008. |
| Exchange-rate API for comparison | Rejected | D-014: no numeric comparison without a verified rate; no free verified source is in scope. |

## Vertical slice

The first milestone (JM-001 to JM-004) proves the whole path through real boundaries: browser `useChat` → Hono `/api/chat` → research pipeline → `ExaSdkPort` (live Exa with the real key) → `src/core` classification → UI message stream → AI Elements conversation showing progress, a cited comparison, and an offer table with evidence listed separately. Acceptance: the fixture-backed end-to-end test passes, and one live smoke run of query Q1 (at most 5 requests) produces at least one merchant offer that passes revalidation. Market selection, history persistence, full error states, and accessibility polish follow in JM-005.
