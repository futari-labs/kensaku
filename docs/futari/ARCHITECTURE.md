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
   `userLocation` on `/answer` is unverified (spike A2 omitted it). If the API rejects or ignores it, `ExaSdkPort` omits it and appends "Market: United States | Singapore | Japan" to the question text instead; the live smoke records which path works.
3. **Stage `offers` (1 request per candidate).** Search candidates 1 and 2. Search candidate 3 only if candidates 1 and 2 together yielded zero merchant offers and a budget token remains. Request: `exa.search("<brand> <name> buy", { type: "auto", numResults: 8, userLocation, contents: { highlights: true, summary: { query, schema: OfferSummarySchema } } })`. `OfferSummarySchema` is the spike's schema: `isProductListing`, `productName`, `merchant`, `price`, `currency`, `availability`. About $0.015 per call.
4. **Stage `validate` (no request).** `src/core` classifies every result as a merchant offer, labeled evidence, or rejected (rules below), then ranks offers.
5. **Stage `compare` (no request).** Resolves the comparison's `[n]` markers against the answer's citations.

Request count: normal question = 1 + 2 = 3 (meets the 1-3 target). Maximum = 1 + 3 candidates + 1 retry = 5. `RequestBudget(5)` issues one token per Exa call; `ExaSdkPort` cannot call the SDK without a token, so a sixth call is impossible by construction (EV-005). Cache hits consume no token.

Retries: at most one retry per run in total (not per call), for HTTP 429 (honouring `Retry-After` up to 5 s), 5xx, or timeout, and only if a budget token remains. Timeout 30 s per Exa call, 90 s per run. Client cancel aborts the in-flight call through `AbortSignal`.

## Offer classification

Applied in this order to each search result; the first matching rule decides. `URL` means the result's URL.

1. URL is not `http(s)` → **rejected: invalid-url**.
2. URL is not one of this run's Exa result URLs → **rejected: url-not-from-run** (offers can never come from synthesized text; spike L6).
3. Product identity fails (below) → **rejected: irrelevant-product** (spike L1).
4. Host is on the aggregator list → **evidence: aggregator**. List (`src/core/hosts.ts`), each entry a host with an optional path prefix: `kakaku.com`, `product.rakuten.co.jp`, `bestpricescanner.com`, `deal.ai`, `idealo.com`, `idealo.de`, `idealo.co.uk`, `pricespy.co.uk`, `pricespy.co.nz`, `google.com` with path `/shopping`, `camelcamelcamel.com`, `shopsavvy.com`.
5. Host is on the editorial list → **evidence: editorial**: `theverge.com`, `howtogeek.com`, `rtings.com`, `soundguys.com`, `techradar.com`, `whathifi.com`, `nytimes.com` with path `/wirecutter`, `cnet.com`, `engadget.com`, `tomsguide.com`, `pcmag.com`.
   Host matching (rules 4 and 5): an entry matches when the URL hostname (lowercased) equals the entry host or ends with `.` + entry host, and, if the entry has a path prefix, the URL path starts with it.
6. `isProductListing !== true` → **evidence: not-a-listing**.
7. Price invalid → **evidence: merchant-no-price** (D-015). Valid means: a finite number > 0, and a currency that after trim and uppercase is three ASCII letters `A-Z`; USD and SGD have at most 2 decimal places; JPY is an integer.
8. Currency not in {USD, SGD, JPY} → **rejected: unsupported-currency** (D-014).
9. Merchant/host consistency fails → **evidence: merchant-mismatch** (spike L3). A missing or empty merchant fails. Otherwise normalize the extracted merchant with NFKC and lowercase, **replace every character that is not a Unicode letter or digit with a space**, split on spaces into tokens, and drop stopwords (`com co net jp sg us www store shop online official singapore japan usa inc ltd the`) and tokens under 3 characters. If any remaining token consists of ASCII letters and digits only, at least one such token must be a substring of some host label (hostname split on `.` and `-`). If no such token remains (for example a Japanese name), the check is skipped (RISKS R-7). Examples: "Amazon.com" → `amazon`; "Macy's" → `macy`; "Harvey Norman Singapore" → `harvey`, `norman`.
10. Otherwise → **merchant offer**.

Offer fields: `merchantHost` (the URL hostname, lowercased, with one leading `www.` removed; displayed as the merchant), `merchantName` (extracted, shown secondary), `canonicalUrl`, `price {amount, currency}`, `availability` (`in_stock | out_of_stock | preorder | unknown`; any other value becomes `unknown`), `source: "exa"`, `retrievedAt` (Kensaku's receipt time of the Exa response; spike L5 showed Exa provides no observation time), `exaRequestId`, `productName`.

URL canonicalization removes `utm_*`, `tag`, `linkCode`, `linkId`, `ref`, `ref_`, `psc`, `gclid`, `fbclid` and keeps all other parameters in their original order. Kensaku adds no affiliate parameters.

Evidence items keep `url`, `title`, `host`, `category`, and any reported price, which the UI labels "reported by <host>; not a merchant offer".

## Product identity

Identity text = the summary's `productName`, or the result title when `productName` is missing or empty after trimming. Normalize with NFKC and lowercase, then split into tokens on every character that is not a Unicode letter or digit (`/[^\p{L}\p{N}]+/u`). Each candidate `modelIdentifier` is normalized and tokenized the same way. An identifier is usable if its joined form has at least 4 characters and it either contains a digit or has 2 or more tokens. A result matches if any usable identifier equals the concatenation of some run of consecutive tokens in the identity text. So `WH-1000XM5` matches "WH 1000XM5" and "WH-1000XM5/LME", but not "WH-1000XM4". `MX Master 3` does not match "MX Master 3S" (EV-002 cases Y06, Y07). A candidate with no usable identifier gets no offers.

## Ranking

Defined in `evals/cases/ranking-currency.json` `rule`: group by currency; market currency first, then USD, SGD, JPY; within a group order by availability rank, amount ascending, merchant host, canonical URL; duplicate canonical URLs collapse to the first received. No arithmetic or comparison ever crosses currency groups, and there is no exchange-rate data (D-014).

## Citations

Defined in `evals/cases/citations.json` `rule`. Markers resolve 1-based into the `/answer` citations; out-of-range markers are removed and counted; paragraphs with no resolved marker are flagged "uncited" in the UI. Source links rendered with `inline-citation` and `sources` are exactly the resolved citation URLs.

## Interfaces and data

File layout (binding; `evals/harness.mjs` uses these paths to decide readiness):

- `src/core/`: `types.ts`, `offers.ts` (`classifyHit`), `identity.ts` (`matchesIdentity`), `url.ts` (`canonicalizeUrl`), `hosts.ts` (lists), `rank.ts` (`rankOffers`), `citations.ts` (`resolveCitations`), `index.ts` (re-exports).
- `src/exa/`: `port.ts` (`ExaPort`, result types, re-exports), `budget.ts` (`RequestBudget`), `errors.ts` (`ExaFailure`), `sdk-port.ts` (`ExaSdkPort`), `fixture-port.ts` (`FixtureExaPort`), `cache.ts`, `ledger.ts`.
- `src/research/pipeline.ts` (`runResearch`); `src/server/app.ts` (Hono app factory), `src/server/index.ts` (listen on 127.0.0.1); `src/web/main.tsx` (entry), `src/web/app/` (Kensaku compositions).
- Evaluation tests: `tests/evals/ev-001-merchant-authenticity.test.ts`, `ev-002-product-relevance.test.ts`, `ev-003-ranking-currency.test.ts`, `ev-004-citations.test.ts`, `ev-005-spend-guard.test.ts`, `ev-006-stream-failures.test.ts`, `ev-009-key-safety.test.ts`; `tests/e2e/ev-007-frontend.spec.ts`; `scripts/live-acceptance.ts` (EV-008).

Module contracts that JM-002, JM-003, and JM-004 implement against (names are binding; internal helpers are free):

```ts
// src/core/types.ts
type Market = "US" | "SG" | "JP";
type Currency = "USD" | "SGD" | "JPY";
type Availability = "in_stock" | "out_of_stock" | "preorder" | "unknown";
interface Candidate { name: string; brand: string; modelIdentifiers: string[] }
interface OfferSummary { isProductListing?: boolean; productName?: string; merchant?: string;
  price?: number; currency?: string; availability?: string }           // as returned by Exa
interface SearchHit { url: string; title: string | null; summary: OfferSummary | null;
  exaRequestId: string; retrievedAt: string }
interface Offer { kind: "merchant-offer"; merchantHost: string; merchantName: string;
  canonicalUrl: string; price: { amount: number; currency: Currency }; availability: Availability;
  source: "exa"; retrievedAt: string; exaRequestId: string; productName: string }
type EvidenceCategory = "aggregator" | "editorial" | "not-a-listing" | "merchant-no-price" | "merchant-mismatch";
interface Evidence { kind: "evidence"; category: EvidenceCategory; url: string; title: string | null;
  host: string; reportedPrice?: { amount: number; currency: string } }
type RejectCategory = "irrelevant-product" | "unsupported-currency" | "url-not-from-run" | "invalid-url";
interface Rejected { kind: "rejected"; category: RejectCategory; url: string }
interface OfferGroup { currency: Currency; offers: Offer[] }
interface ResolvedCitations { renderedText: string; sources: string[]; unresolvedMarkers: number;
  uncitedParagraphs: number[] /* indexes; EV-004 compares .length with the case's count and sources.length with resolvedUrlCount */ }

// src/core/index.ts
function classifyHit(hit: SearchHit, candidate: Candidate, runResultUrls: ReadonlySet<string>): Offer | Evidence | Rejected;
function matchesIdentity(identityText: string, candidate: Candidate): boolean;
function canonicalizeUrl(url: string): string;
function rankOffers(offers: Offer[], market: Market): OfferGroup[];
function resolveCitations(text: string, citationUrls: string[]): ResolvedCitations;

// src/exa/port.ts
interface AnswerResult { comparison: string; candidates: Candidate[]; citationUrls: string[];
  exaRequestId: string; retrievedAt: string; costDollars: number; cached: boolean }
interface SearchResult { hits: SearchHit[]; exaRequestId: string; retrievedAt: string;
  costDollars: number; cached: boolean }
interface ExaPort {
  answerCandidates(question: string, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<AnswerResult>;
  searchOffers(candidate: Candidate, market: Market, budget: RequestBudget, signal: AbortSignal): Promise<SearchResult>;
}
// src/exa/budget.ts
class RequestBudget { constructor(max: 5); take(): BudgetToken /* throws ExaFailure kind budget_exhausted */; used: number }
// src/exa/errors.ts
class ExaFailure extends Error { kind: "auth" | "credits_exhausted" | "monthly_limit" | "rate_limited" | "upstream" | "timeout" | "budget_exhausted"; retryAfterMs?: number }
```

Fixture scenarios: `FixtureExaPort` does not match requests; it replays a named scenario from `tests/fixtures/scenarios/<name>.json`. A scenario lists, per call in order, a response (a reference to a frozen `evals/fixtures/exa-live` file or a synthetic, labeled body), an injected error kind, or a delay. Baseline scenario `xm5-us`: a synthetic, labeled candidates answer (one candidate, Sony WH-1000XM5) composed with the real `A1-answer` comparison and citations, followed by the real `S1-headphones` search; `xm5-sg` and `xm5-jp` use `S8` and `S9`. Error, slow, and cancel scenarios cover EV-006 and EV-007. In fixture mode only, the request body may name the scenario (`fixtureScenario`); in live mode that field is rejected with `invalid_request`. JM-003 creates the scenario loader and baseline scenarios; JM-004 and JM-005 may add scenarios.

`POST /api/chat`. Request: AI SDK `useChat` body `{ messages: UIMessage[], market: "US" | "SG" | "JP" }`, parsed with zod at the boundary. Only the last user message's text is researched; earlier turns are display history. Response: `createUIMessageStreamResponse` with these parts:

| Part | Payload |
| --- | --- |
| `data-progress` | `{ stage: "candidates" \| "offers" \| "validate" \| "compare", status: "running" \| "done" \| "failed", detail? }` |
| `text` | Comparison text with resolved markers |
| `source-url` | One per resolved citation |
| `data-products` | `[{ candidate, offerGroups: [{ currency, offers[] }], evidence[], rejectedCounts }]` |
| `data-usage` | `{ exaRequests, cacheHits, costDollars, monthRequests, monthLimit }` |
| `data-error` | `{ kind: "auth" \| "credits_exhausted" \| "monthly_limit" \| "rate_limited" \| "upstream" \| "timeout" \| "invalid_request", message, partial: boolean }` |

`budget_exhausted` is not a user-facing error: if the budget runs out during the offers stage, the stage ends early, unsearched candidates show "Not searched: per-question request limit reached", and the run completes. Classification runs per candidate inside the `offers` stage; the `validate` stage performs final ranking and de-duplication across candidates.

Run lock: the server runs one research run at a time. A second concurrent `POST /api/chat` gets HTTP 409 before any stream starts, and the client shows "A research run is already in progress". The lock is released in a `finally` block on completion, failure, or abort.

`cancelled` is a client-derived state: when the user cancels, `useChat` aborts the request and the client marks the run cancelled. The server sees the abort, aborts the in-flight Exa call, writes no further parts, and logs `cancelled`. EV-006 checks the server side (Exa call aborted, no parts after the abort, log line); EV-007 checks the client side.

`GET /api/usage` returns the ledger for the current month. `GET /api/health` returns `{ ok, exaConfigured, mode }`, never the key.

Run states: `running → completed | failed | cancelled`. A run that fails after the candidates stage ends `failed` with `partial: true`, and the products it already validated stay visible and labeled partial.

History (D-016): the client stores `{ version: 1, messages, savedAt }` in `localStorage["kensaku.history.v1"]` after each completed or failed run, validated with zod on load. Invalid or newer-version data is discarded with a visible notice. "Clear history" opens an `alert-dialog` and removes the key. The server stores no conversation.

## Spend guard and usage ledger

- Per run: `RequestBudget(5)` (D-017).
- Per month: `.cache/ledger/YYYY-MM.json` `{ requests, costDollars, exhaustedAt? }`, written atomically (temporary file plus rename). The server handles one research run at a time; a second concurrent `POST /api/chat` gets HTTP 409, so the ledger has a single writer. Limits: `KENSAKU_MONTHLY_REQUEST_LIMIT` (default 400) and `KENSAKU_MONTHLY_COST_LIMIT` (default 8.00 dollars, under the $10 monthly free credit). When either would be exceeded the run fails with `monthly_limit` before calling Exa.
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
- Network: the listen address is hard-coded to `127.0.0.1` (no host setting exists). The server rejects with 403 requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding guard), and any `POST` whose `Origin` is present and not one of those. Under `pnpm dev` (`KENSAKU_DEV=1`) the Vite origins `http://127.0.0.1:5173` and `http://localhost:5173` are also allowed; Vite's proxy keeps the original `Host` header.
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

The first milestone (JM-001 to JM-004) proves the whole path through real boundaries: browser `useChat` → Hono `/api/chat` → research pipeline → `ExaSdkPort` (live Exa with the real key) → `src/core` classification → UI message stream → AI Elements conversation showing progress, a cited comparison, and an offer table with evidence listed separately. Acceptance: the fixture-backed end-to-end test passes, and a live smoke of Q1 (named model) and Q2 (open-ended, so Exa-generated `modelIdentifiers` are exercised) makes at most 10 requests in total; Q1 shows at least one merchant offer that passes revalidation, and the Q2 outcome (offers or an explicit no-offers state) is recorded. Both run logs are committed under `.futari/evidence/live/` at or before the evidence file's `Tested-Commit`. Market selection, history persistence, full error states, and accessibility polish follow in JM-005.
