# Architecture

Status: proposed for approval with plan `kensaku-v1-2`. This document keeps the MVP and v1.1 architecture (built and accepted under `kensaku-mvp-v1` and `kensaku-v1-1`), marks v1.1 changes **(v1.1)**, and adds the v1.2 simulated commerce in "Simulated commerce (v1.2)" and "Vertical slice (v1.2)"; other v1.2 amendments are marked **(v1.2)**. Evidence: `docs/futari/research/exa-2026-11-21.md`, `references-2026-11-21.md`, `v1-1-spike-2026-11-21.md`, and (v1.2) `stripe-2026-11-23.md`.

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
   <img src="/api/image/:id">  (v1.1)       │ src/server/images.ts  (v1.1)              │
   ─────────────────────────────────────▶   │   registry, address policy, rule I3,      │
                                            │   ImageFetchPort ──▶ merchant image hosts │
                                            │   (.cache/images/ on disk, gitignored)    │
                                            └──────────────────────────────────────────┘
```

(v1.1) The browser never contacts a third party: the Content-Security-Policy allows only `'self'`, and product images arrive through `/api/image/:id`. **(v1.2)** One exception: the owner-initiated top-level navigation to Stripe-hosted Checkout and Stripe's redirect back (D-055).

| Module | Responsibility | State it owns |
| --- | --- | --- |
| `src/core/` | Pure functions and types: offer classification, product identity, currency rules, ranking, citation resolution, URL canonicalization. No I/O. | None |
| `src/exa/` | `ExaPort` interface; `ExaSdkPort` (the only importer of `exa-js`); `FixtureExaPort` for tests; `RequestBudget`; disk cache; monthly usage ledger; error mapping. | `.cache/exa/*.json`, `.cache/ledger/YYYY-MM.json` |
| `src/research/` | `runResearch(question, market, port, signal)` runs the fixed stage sequence and yields typed `RunEvent`s. | One run's in-memory state |
| `src/server/` | Hono app: `POST /api/chat`, `GET /api/usage`, `GET /api/health`, (v1.1) `GET /api/image/:id`, static files for the built web app with the Content-Security-Policy. Converts `RunEvent`s to the AI SDK UI message stream. Binds 127.0.0.1 only. | (v1.1) `.cache/images/<id>.json` and `<id>.bin` |
| `src/web/` | React app composed from unmodified AI Elements and shadcn/ui components; Kensaku-owned compositions in `src/web/app/`. (v1.1) `public/theme-init.js` applies the theme before the bundle. | `localStorage` keys `kensaku.history.v1`, `kensaku.market.v1`, (v1.1) `kensaku.theme.v1` |

Why this shape: Kensaku is a single-user local tool, so one process and one package is the simplest thing that meets every requirement. Business rules sit in `src/core` as pure functions, so the frozen evaluation cases test them directly without network or UI.

## Research pipeline

A fixed procedure, not an open-ended agent loop (adopted from the Aria Labs and ShopSense references). Each run:

1. **Cache lookup.** Key = SHA-256 of `{endpoint, normalized request body, market}`. A hit returns the stored response with its original `receivedAt` and costs no request. TTL 6 hours.
2. **Stage `candidates` (1 request).** `exa.answer(question, { outputSchema })` with schema `{ comparison: string, candidates: [{ name, brand, modelIdentifiers[] }] (max 3) }` and the market's `userLocation`. Spike A2 confirmed this returns cited comparison text plus candidates in one $0.005 call.
   `userLocation` on `/answer` is unverified (spike A2 omitted it). If the API rejects or ignores it, `ExaSdkPort` omits it and appends "Market: United States | Singapore | Japan" to the question text instead; the live smoke records which path works. (EV-008 run 1 used `userLocation` successfully.)
   **(v1.1)** The binding `outputSchema` is `request.body.outputSchema` of the frozen fixture `evals/fixtures/exa-live/V9-answer-us-tight-identifiers.json` (EV-017 deep-equals it). Compared with the MVP schema, each candidate item gains two properties, the `modelIdentifiers` description is tightened (spike V8 returned feature names such as "Easy-Switch"; V9 returned only "MX Vertical"), and `required` becomes `["name", "brand", "modelIdentifiers", "keySpecs", "reason"]`:
   ```json
   "modelIdentifiers": { "type": "array", "items": { "type": "string" }, "description": "Manufacturer model names or model numbers only (for example WH-1000XM5 or MX Master 3S). No features, specifications, colours, connectivity, or generation labels." },
   "keySpecs": { "type": "array", "maxItems": 5, "items": { "type": "string" }, "description": "Up to 5 short key specifications, each under 60 characters." },
   "reason": { "type": "string", "description": "One or two sentences on why this product fits the question, with numbered citation markers like [1]. Do not mention prices or currency amounts." }
   ```
   Everything else in the request is unchanged. The parser treats `keySpecs` and `reason` as optional, because cached MVP answers and stored history lack them.
3. **Stage `offers` (1 request per candidate).** Search candidates 1 and 2. Search candidate 3 only if candidates 1 and 2 together yielded zero merchant offers and a budget token remains. Request: `exa.search("<brand> <name> price <market name> buy", { type: "auto", numResults: 8, userLocation, contents: { highlights: true, summary: { query, schema: OfferSummarySchema } } })`, where the market name is `United States`, `Singapore`, or `Japan` **(v1.1, D-033; the MVP query was `"<brand> <name> buy"`, which returned US stores for SG questions, spike V-F1/V-F2)**. `OfferSummarySchema` is the spike's schema: `isProductListing`, `productName`, `merchant`, `price`, `currency`, `availability`. About $0.015 per call. The cache key includes the query, so v1.1 never reuses an MVP offer search.
4. **Stage `validate` (no request).** `src/core` classifies every result as a merchant offer, labeled evidence, or rejected (rules below), then ranks offers. **(v1.1)** It also selects each product's image candidates (rules I1 and I2) and registers their URLs with the image proxy, and normalizes `keySpecs` and resolves `reason` (Product content).
5. **Stage `compare` (no request).** Resolves the comparison's `[n]` markers against the answer's citations.

Request count: normal question = 1 + 2 = 3 (meets the 1-3 target). Maximum = 1 + 3 candidates + 1 retry = 5. `RequestBudget(5)` issues one token per Exa call; `ExaSdkPort` cannot call the SDK without a token, so a sixth call is impossible by construction (EV-005). Cache hits consume no token.

Retries: at most one retry per run in total (not per call), for HTTP 429 (honouring `Retry-After` up to 5 s), 5xx, or timeout, and only if a budget token remains. Timeout 30 s per Exa call, 90 s per run. Client cancel aborts the in-flight call through `AbortSignal`.

## Offer classification

Applied in this order to each search result; the first matching rule decides. `URL` means the result's URL.

1. URL is not `http(s)` → **rejected: invalid-url**.
2. URL is not one of this run's Exa result URLs → **rejected: url-not-from-run** (offers can never come from synthesized text; spike L6).
3. Product identity fails (below) → **rejected: irrelevant-product** (spike L1).
4. Host is on the aggregator list → **evidence: aggregator**. List (`src/core/hosts.ts`), each entry a host with an optional path prefix: `kakaku.com`, `product.rakuten.co.jp`, `bestpricescanner.com`, `deal.ai`, `idealo.com`, `idealo.de`, `idealo.co.uk`, `pricespy.co.uk`, `pricespy.co.nz`, `google.com` with path `/shopping`, `camelcamelcamel.com`, `shopsavvy.com`; **(v1.1)** `kiasuprice.com`, `priceme.com`.
5. Host is on the editorial list → **evidence: editorial**: `theverge.com`, `howtogeek.com`, `rtings.com`, `soundguys.com`, `techradar.com`, `whathifi.com`, `nytimes.com` with path `/wirecutter`, `cnet.com`, `engadget.com`, `tomsguide.com`, `pcmag.com`; **(v1.1)** `aboutamazon.com`, `aboutamazon.jp`, `androidcentral.com`, `note.com`, `hardwarezone.com.sg`.
   Host matching (rules 4, 5 and 5a): an entry matches when the URL hostname (lowercased) equals the entry host or ends with `.` + entry host, and, if the entry has a path prefix, the URL path starts with it.
   **(v1.1)** Path segments (rules 5b and 5c) are the URL path split on `/`, empty segments dropped, each percent-decoded (left as is if decoding fails) and lowercased. The query string is not a segment.
5a. **(v1.1)** Host is on the second-hand marketplace list → **evidence: marketplace**: `carousell.sg`, `carousell.com`, `jp.mercari.com`, `auctions.yahoo.co.jp`.
5b. **(v1.1, CR-002)** The hostname's first label is exactly `search`, or any path segment is one of `search`, `s`, `category`, `categories`, `bestsellers`, `productlist`, or there is a `collections` segment with no later `products` segment → **evidence: search-or-category**. This applies even when Exa reports `isProductListing: true` (run 1 Q5-O1).
5c. **(v1.1)** Any path segment is one of `news`, `blog`, `blogs`, `review`, `reviews`, `article`, `articles` → **evidence: editorial**.
6. `isProductListing !== true` → **evidence: not-a-listing**.
7. Price invalid → **evidence: merchant-no-price** (D-015). Valid means: a finite number > 0, and a currency that after trim and uppercase is three ASCII letters `A-Z`; USD and SGD have at most 2 decimal places; JPY is an integer. **(v1.1, D-032)** Before that check, a trimmed currency string exactly equal to `S$` or `SG$` becomes `SGD`, `US$` becomes `USD`, and `¥`, `￥`, `円` or `JP¥` becomes `JPY`. A bare `$` and every other string are unchanged, so `$` stays invalid.
8. Currency not in {USD, SGD, JPY} → **rejected: unsupported-currency** (D-014).
9. Merchant/host consistency fails → **evidence: merchant-mismatch** (spike L3). A missing or empty merchant fails. Otherwise normalize the extracted merchant with NFKC and lowercase, **replace every character that is not a Unicode letter or digit with a space**, split on spaces into tokens, and drop stopwords (`com co net jp sg us www store shop online official singapore japan usa inc ltd the`) and tokens under 3 characters. If any remaining token consists of ASCII letters and digits only, at least one such token must be a substring of some host label (hostname split on `.` and `-`). If no such token remains (for example a Japanese name), the check is skipped (RISKS R-7). Examples: "Amazon.com" → `amazon`; "Macy's" → `macy`; "Harvey Norman Singapore" → `harvey`, `norman`.
10. Otherwise → **merchant offer**.

Offer fields: `merchantHost` (the URL hostname, lowercased, with one leading `www.` removed; displayed as the merchant), `merchantName` (extracted, shown secondary), `canonicalUrl`, `price {amount, currency}`, `availability` (`in_stock | out_of_stock | preorder | unknown`; any other value becomes `unknown`), `source: "exa"`, `retrievedAt` (Kensaku's receipt time of the Exa response; spike L5 showed Exa provides no observation time), `exaRequestId`, `productName`.

URL canonicalization removes `utm_*`, `tag`, `linkCode`, `linkId`, `ref`, `ref_`, `psc`, `gclid`, `fbclid` and keeps all other parameters in their original order. Kensaku adds no affiliate parameters.

Evidence items keep `url`, `title`, `host`, `category`, and any reported price, which the UI labels "reported by <host>; not a merchant offer". **(v1.1)** UI labels for the new categories: `marketplace` → "Second-hand marketplace", `search-or-category` → "Search or category page".

**(v1.1) Effect on frozen MVP cases.** A reference implementation of these written rules, independent of `src/core`, reproduces all 54 MVP labels under the MVP rules and differs under the v1.1 rules only on L29 (`hothardware.com/news/...`: merchant-mismatch → editorial, still evidence) and Y03 (currency `US$`: merchant-no-price → USD offer). `evals/cases/offer-classification-v1-1.json` records both as `supersedes` entries; the MVP case file is unchanged (D-031, D-032).

## Product identity

Identity text = the summary's `productName`, or the result title when `productName` is missing or empty after trimming. Normalize with NFKC and lowercase, then split into tokens on every character that is not a Unicode letter or digit (`/[^\p{L}\p{N}]+/u`). Each candidate `modelIdentifier` is normalized and tokenized the same way. An identifier is usable if its joined form has at least 4 characters and it either contains a digit or has 2 or more tokens. A result matches if any usable identifier equals the concatenation of some run of consecutive tokens in the identity text. So `WH-1000XM5` matches "WH 1000XM5" and "WH-1000XM5/LME", but not "WH-1000XM4". `MX Master 3` does not match "MX Master 3S" (EV-002 cases Y06, Y07). A candidate with no usable identifier gets no offers.

## Ranking

Defined in `evals/cases/ranking-currency.json` `rule`: group by currency; market currency first, then USD, SGD, JPY; within a group order by availability rank, amount ascending, merchant host, canonical URL; duplicate canonical URLs collapse to the first received. No arithmetic or comparison ever crosses currency groups, and there is no exchange-rate data (D-014).

## Citations

Defined in `evals/cases/citations.json` `rule`. Markers resolve 1-based into the `/answer` citations; out-of-range markers are removed and counted; paragraphs with no resolved marker are flagged "uncited" in the UI. Source links rendered with `inline-citation` and `sources` are exactly the resolved citation URLs.

## Product content (v1.1)

Defined in `evals/cases/product-content.json` `rules` (EV-012):

- `normalizeKeySpecs(value)`: trim each string; drop empty strings and strings longer than 80 characters; drop exact duplicates, keeping the first; keep at most 5 in Exa's order. A missing or non-array value gives `[]`.
- `resolveReason(reason, citationUrls)`: a non-empty string is resolved with `resolveCitations` against the same citations as the comparison (EV-004 rule, unchanged). A missing, non-string, or whitespace-only reason gives `null`.
- `cutLeakedStructure(text)` (D-042, owner decision): Exa sometimes appends leaked structured output to good text. Examples: spike V9's reason and comparison, and the accepted MVP run's Q4 comparison, which the MVP displayed unedited (`…[1][2][3][8].}}} ,top_results:[1,2,3,4,8]} {content:{candidates:…`).
  - If the text contains `{` or `}`, keep only the text before the first such character, remove trailing whitespace, and mark it `truncated`.
  - If no Unicode letter remains, return `null`. A null comparison is replaced by the note; a null reason is omitted with no note, like a missing reason.
  - The cut applies to the comparison (in the pipeline, before `resolveCitations`) and to each reason (inside `resolveReason`).
  - The UI shows "Exa's answer ended in malformed output, which is not shown." beside truncated text and in place of a null comparison.
  - None of the frozen EV-004 texts contains a brace, so EV-004 is unaffected. 2 of the 16 real comparisons in the fixtures and logs are affected (EV-012 `comparisonCases`).
- Card prices come only from merchant offers. Kensaku does not edit Exa's reason text. The schema asks Exa not to mention prices; V8 complied, but V10 still quoted "39,980 yen" (risk R-20).
- The card reads key specs and the reason only from the normalized `data-products` entry fields, never from the raw `Candidate` fields.

## Product images (v1.1)

The rules are frozen in `evals/cases/image-selection.json` `rules` (EV-013). Summary:

- **I1, URL eligibility (no network).** At most 2048 characters; parses; `http` or `https`; no username or password; the file name (text after the last `/` of the path, percent-decoded or as written if decoding fails, lowercased), does not end in `.svg` and contains none of `logo`, `social`, `share`, `placeholder`, `missing`, `noimage`, `no-image`, `no_image`, `sprite`, `banner`, `campaign`, `brandimage`, `uedata`, `pixel`, `spacer`, `favicon`, `1x1`. Tokens apply to the file name only, because real product photos live under paths such as Courts' `/default/` (spike V-F9).
- **I2, eligible pages and order.** Per product, in Exa result order across that product's searches: tier 1 is merchant offers in the selected market's currency; tier 2 is pages on a manufacturer host (host labels include the brand, normalized, at least 3 characters) classified as a merchant offer, not-a-listing, or merchant-no-price; tier 3 is any other merchant offer. Aggregator, editorial, marketplace, search-or-category, merchant-mismatch, and rejected hits never supply images. Drop repeated image URLs; keep at most 4.
- **I3, bytes verdict (after fetching).** At most 5 MiB; magic bytes identify JPEG, PNG, WebP, or AVIF (AVIF size from the `ispe` box); both dimensions known; shorter side at least 200 px; width/height from 0.5 to 1.8 inclusive. The 1.8 limit excludes the 1.91:1 social-card format: in the probe, every image at that ratio was a logo card, an editorial photo, or a press shot (Logitech, The Verge, note.com), and every correct product photo was 1.71 or narrower.
- Verdict precedence is written in the case file's rules. The first failing check is reported, in this order: I1 invalid-url, bad-scheme, credentials, svg, deny-pattern; I3 too-large, unsupported-type, no-dimensions, too-small, aspect.

Each candidate sent to the browser is `{ id, sourceHost, sourceTitle }`. Here `id` is the lowercase hex SHA-256 of the image URL, `sourceHost` is the page's hostname without a leading `www.`, and `sourceTitle` is the page's product name as Exa reported it (`summary.productName`, else the result title, cut to 120 characters). The image URL itself never reaches the browser.

The client renders the first candidate in an AspectRatio box with a Skeleton until `load`. On `error` it tries the next candidate. After the last one fails, it shows the "No verified product image" panel. The caption names the candidate that actually loaded.

## Image proxy (v1.1)

`src/server/images.ts` (helpers may live under `src/server/images/`), mounted at `GET /api/image/:id` behind the same Host/Origin guard as the rest of the API (D-029). JM-103 builds it; JM-104 calls `registerImageCandidates` from the pipeline.

- **Cross-site requests.** Browsers send no `Origin` on an `<img>` GET, so the Host/Origin guard alone cannot stop another site from embedding `/api/image/<id>` (independent review finding 6). The route therefore returns 403 when a `Sec-Fetch-Site` header is present and is not `same-origin`, and every response carries `Cross-Origin-Resource-Policy: same-origin`.
- **Registry.** During a run, `registerImageCandidates` writes `.cache/images/<id>.json` with `{ url, pageUrl, registeredAt }`, updates `registeredAt` if the entry exists, and keeps any verdict. `GET /api/image/:id` with an id that is not 64 lowercase hex characters, or has no registry entry, returns 404 without any outbound request. So the proxy is not an open fetcher: it only fetches URLs that came from Exa results in a run on this machine.
- **Cache lifecycle (single rule).**
  - Accepted bytes (`<id>.bin`, verdict `ok`) are served from disk for 7 days after they were fetched. After that they are refetched on the next request, as long as the registry entry exists.
  - Rule I3 rejections are cached for 24 hours (422). Upstream failures (blocked address, upstream status, timeout, too large, too many redirects) are cached for 10 minutes (502).
  - At server start and after each registration, entries whose `registeredAt` is more than 30 days old are deleted with their bytes. If the bytes total more than 500 MB, the oldest-fetched bytes are deleted until the total is under the cap (their entries stay and refetch on demand).
  - A card restored from history after its entry was pruned gets 404 and shows the fallback.
- **Fetch.** `ImageFetchPort.fetch(url, signal)`: `NetworkImageFetch` in live mode, `FixtureImageFetch` in fixture mode. `FixtureImageFetch` serves bytes from `tests/fixtures/images/` by a mapping in the fixture scenario, so CI makes no internet request.
  - `NetworkImageFetch` uses `node:http` and `node:https` (global `fetch` cannot pin an address). It accepts only `http` and `https` URLs on port 80 or 443 (default or explicit).
  - For each hop it resolves the hostname once with `dns.lookup({ all: true })`; a host that is an IP literal is used as is. It refuses the request unless every resolved address is allowed:
    - IPv4 must be public unicast. Not 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, or 224/4 and above.
    - IPv6 must be inside 2000::/3 and outside 2001::/32 (Teredo), 2001:db8::/32, and 2002::/16 (6to4). This also excludes ::1, ::, IPv4-mapped and IPv4-compatible forms, NAT64 64:ff9b::/96, fc00::/7, fe80::/10, fec0::/10, and ff00::/8.
  - It then connects through a `lookup` override that returns only the checked address, with the original Host header and TLS SNI, so DNS cannot change between check and connect.
  - Redirects are followed manually, at most 3, and each hop is re-checked. Requests send `Accept: image/avif,image/webp,image/png,image/jpeg`, a fixed generic User-Agent, and no cookies, credentials, or Referer. The whole fetch times out after 8 s and stops reading after 5 MiB.
- **Validation.** Rule I3 on the bytes. The response's own Content-Type is not trusted.
- **Response.** Status 200 with `Content-Type` from the sniffed type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: private, max-age=604800`, and no upstream headers. Errors are 403 (cross-site or guard), 404 (unknown id), 422 (rule I3), and 502 (blocked address or port, upstream status, timeout, too large, or too many redirects). The error body is a short JSON reason with no upstream content.
- **Concurrency.** At most 4 upstream fetches at once, and one in-flight fetch per id (later requests await it). The proxy never takes an Exa budget token or writes the Exa ledger.
- **Logging.** One JSON line per fetch: id, host, verdict, bytes, and duration. Never the full URL query string.

## Content-Security-Policy (v1.1)

Every response from the Hono server, except `/api/image/:id`, which sends its own stricter policy, carries:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
```

**(v1.2)** The policy is unchanged. Navigating to Stripe-hosted Checkout uses `window.location.assign`, a top-level navigation that `form-action` and `connect-src` do not govern (D-055).

`style-src 'unsafe-inline'` is needed only for inline `style` attributes set by React components (for example motion and Radix positioning); no inline script is allowed. The theme bootstrap is therefore an external file. `pnpm dev` (Vite) is not covered; the tests run against `pnpm start`.

## Theme (v1.1)

- shadcn/ui class-based dark mode: the `.dark` class on `<html>` and the existing `:root` and `.dark` CSS variables in `src/web/index.css` (already present from the shadcn init, `@custom-variant dark`). No variable is added or changed (D-036).
- `public/theme-init.js` is a classic script referenced in `index.html`'s `<head>` before the module script, so it blocks first paint. Vite copies it unchanged to `dist/`. It does `try { light = localStorage.getItem("kensaku.theme.v1") === "light" } catch {}`, then sets or removes the `dark` class and sets `document.documentElement.style.colorScheme`.
- `src/web/app/theme.ts` exports `THEME_KEY`, `readTheme(): "dark" | "light"`, and `applyTheme(theme)`, which writes storage inside try/catch and updates the class and `colorScheme`. `ThemeToggle.tsx` uses the existing shadcn Button (ghost, icon size) with lucide `Sun` or `Moon`, `aria-label` "Switch to light theme" or "Switch to dark theme", and the existing Tooltip.
- There is no "system" mode: first-time visitors get dark whatever the OS preference (owner requirement).

## Product cards (v1.1)

- Layout: the main column widens from `max-w-3xl` to `max-w-6xl`. The products section is a CSS grid with one column below 768 px and two from 768 px. A single product spans one column.
- The image is full-bleed: the AspectRatio box sits outside CardContent's padding and spans the card's full width.
- To reach the REQ-012 sizes, JM-105 may override container width and padding only through `className` props of the unmodified components, for example `MessageContent` `max-w-full` and `ConversationContent` `px-2` on small screens. The review measured about 301 px of image width at 375 px with the MVP's padding; REQ-012's floor is 300 px.
- `ProductCard.tsx` composes official components only: `card` (Card, CardHeader, CardTitle, CardContent, CardFooter), `aspect-ratio` (ratio 4/3), `skeleton`, `item` (one Item per merchant offer), `badge` (availability), `collapsible` (Other markets, Research details), `button`, and the AI Elements `inline-citation` for the reason. The comparison above the cards keeps AI Elements `message`, `inline-citation`, and `sources`, and progress keeps `task` and `shimmer`. The AI Elements `image` component is not used: it renders base64 images generated by a model (`Experimental_GeneratedImage`), which v1.1 forbids.
- Price summary: from the offers in the market's currency only, "From <lowest listed price> <code> · <n> <market name> offer(s)". The lowest listed price includes out-of-stock offers, whose availability badge stays visible in the list. Otherwise "No <market name> offers found".
- Other markets: offer groups whose currency is not the market's, in `rankOffers` order, inside a Collapsible titled "Other markets (may not ship to <market name>) · <n>", closed by default.
- Research details: evidence items with their labels, and the rejected count, inside a Collapsible closed by default.
- Prices: `formatPrice` keeps the MVP format, amount plus ISO code (for example `289.00 SGD`). No symbol is shown.

## Interfaces and data

File layout (binding; `evals/harness.mjs` uses these paths to decide readiness):

- `src/core/`: `types.ts`, `offers.ts` (`classifyHit`), `identity.ts` (`matchesIdentity`), `url.ts` (`canonicalizeUrl`), `hosts.ts` (lists), `rank.ts` (`rankOffers`), `citations.ts` (`resolveCitations`), `index.ts` (re-exports).
- `src/exa/`: `port.ts` (`ExaPort`, result types, re-exports), `budget.ts` (`RequestBudget`), `errors.ts` (`ExaFailure`), `sdk-port.ts` (`ExaSdkPort`), `fixture-port.ts` (`FixtureExaPort`), `cache.ts`, `ledger.ts`.
- `src/research/pipeline.ts` (`runResearch`); `src/server/app.ts` (Hono app factory), `src/server/index.ts` (listen on 127.0.0.1); `src/web/main.tsx` (entry), `src/web/app/` (Kensaku compositions).
- Evaluation tests: `tests/evals/ev-001-merchant-authenticity.test.ts`, `ev-002-product-relevance.test.ts`, `ev-003-ranking-currency.test.ts`, `ev-004-citations.test.ts`, `ev-005-spend-guard.test.ts`, `ev-006-stream-failures.test.ts`, `ev-009-key-safety.test.ts`; `tests/e2e/ev-007-frontend.spec.ts`; `scripts/live-acceptance.ts` (EV-008, MVP, kept as history).
- **(v1.1)** `src/core/images.ts` (`imageUrlVerdict`, `rankImageCandidates`, `imageBytesVerdict`, `sniffImage`), `src/core/content.ts` (`normalizeKeySpecs`, `resolveReason`); `src/server/images.ts` (registry, `ImageFetchPort`, `NetworkImageFetch`, `FixtureImageFetch`, address policy, route); `src/web/app/theme.ts`, `src/web/app/ThemeToggle.tsx`, `src/web/app/ProductCard.tsx`; `public/theme-init.js`; `tests/fixtures/images/` (synthetic, labeled fixture images).
- **(v1.1)** Evaluation tests: `tests/e2e/ev-010-theme.spec.ts`, `tests/evals/ev-011-page-classification.test.ts`, `ev-012-product-content.test.ts`, `ev-013-image-selection.test.ts`, `ev-014-image-proxy.test.ts`, `tests/e2e/ev-015-product-cards.spec.ts`, `scripts/live-acceptance-v1-1.ts` (EV-016), `tests/evals/ev-017-request-contract.test.ts`.

Module contracts that JM-002, JM-003, and JM-004 implemented in the MVP (historical task names; the names below stay binding, and internal helpers are free). The "(v1.1) additions" block further down replaces the MVP declarations of `EvidenceCategory`, `Candidate`, and `SearchHit` where they differ:

```ts
// src/core/types.ts
type Market = "US" | "SG" | "JP";
type Currency = "USD" | "SGD" | "JPY";
type Availability = "in_stock" | "out_of_stock" | "preorder" | "unknown";
interface Candidate { name: string; brand: string; modelIdentifiers: string[] }
interface OfferSummary { isProductListing?: boolean; productName?: string; merchant?: string;
  price?: number; currency?: string; availability?: string }           // as returned by Exa
interface SearchHit { url: string; title: string | null; summary: OfferSummary | null;
  exaRequestId: string; retrievedAt: string; image?: string | null /* (v1.1) Exa result `image` */ }
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

// (v1.1) src/core/types.ts additions
type EvidenceCategory = "aggregator" | "editorial" | "not-a-listing" | "merchant-no-price" | "merchant-mismatch"
  | "marketplace" | "search-or-category";
interface Candidate { name: string; brand: string; modelIdentifiers: string[]; keySpecs?: string[]; reason?: string }
interface ImageSource { imageUrl: string; pageUrl: string; sourceTitle: string }      // server-side only
interface ImageCandidate { id: string; sourceHost: string; sourceTitle: string }      // sent to the browser
type ImageUrlVerdict = "ok" | "invalid-url" | "bad-scheme" | "credentials" | "svg" | "deny-pattern";
type ImageBytesVerdict = "ok" | "too-large" | "unsupported-type" | "no-dimensions" | "too-small" | "aspect";
interface SniffedImage { type: "jpeg" | "png" | "webp" | "avif" | "gif" | "unknown"; width: number; height: number }

// (v1.1) src/core/index.ts additions
function imageUrlVerdict(url: string): ImageUrlVerdict;
function rankImageCandidates(hits: { hit: SearchHit; result: Offer | Evidence | Rejected }[],
  candidate: Candidate, market: Market): ImageSource[];                               // rule I2, at most 4
function sniffImage(bytes: Uint8Array): SniffedImage;
function imageBytesVerdict(image: SniffedImage, byteLength: number): ImageBytesVerdict; // rule I3
function normalizeKeySpecs(value: unknown): string[];
function cutLeakedStructure(text: string): { text: string; truncated: boolean } | null;   // D-042
function resolveReason(reason: unknown, citationUrls: string[]): (ResolvedCitations & { truncated: boolean }) | null;

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
| `data-products` | `[{ candidate, offerGroups: [{ currency, offers[] }], evidence[], rejectedCounts }]`; **(v1.1)** each entry also has optional `keySpecs: string[]`, `reason: ResolvedCitations \| null`, and `imageCandidates: ImageCandidate[]`. The fields are optional, so MVP history still validates. |
| `data-usage` | `{ exaRequests, cacheHits, costDollars, monthRequests, monthLimit }` |
| `data-error` | `{ kind: "auth" \| "credits_exhausted" \| "monthly_limit" \| "rate_limited" \| "upstream" \| "timeout" \| "invalid_request", message, partial: boolean }` |

`budget_exhausted` is not a user-facing error: if the budget runs out during the offers stage, the stage ends early, unsearched candidates show "Not searched: per-question request limit reached", and the run completes. Classification runs per candidate inside the `offers` stage; the `validate` stage performs final ranking and de-duplication across candidates.

Run lock: the server runs one research run at a time. A second concurrent `POST /api/chat` gets HTTP 409 before any stream starts, and the client shows "A research run is already in progress". The lock is released in a `finally` block on completion, failure, or abort.

`cancelled` is a client-derived state: when the user cancels, `useChat` aborts the request and the client marks the run cancelled. The server sees the abort, aborts the in-flight Exa call, writes no further parts, and logs `cancelled`. EV-006 checks the server side (Exa call aborted, no parts after the abort, log line); EV-007 checks the client side.

`GET /api/usage` returns the ledger for the current month. `GET /api/health` returns `{ ok, exaConfigured, mode }`, never the key. **(v1.1)** `GET /api/image/:id` is specified in "Image proxy".

Run states: `running → completed | failed | cancelled`. A run that fails after the candidates stage ends `failed` with `partial: true`, and the products it already validated stay visible and labeled partial.

History (D-016): the client stores `{ version: 1, messages, savedAt }` in `localStorage["kensaku.history.v1"]` after each completed or failed run, validated with zod on load. Invalid or newer-version data is discarded with a visible notice. "Clear history" opens an `alert-dialog` and removes the key. The server stores no conversation. **(v1.1)** The version stays 1, because the new `data-products` fields are optional (D-040). A restored card asks `/api/image/:id` for its candidates. While the registry entry exists (30 days from its last registration), the proxy serves cached bytes or refetches them. After the entry is pruned or `.cache/images/` is deleted, it answers 404 and the card shows the fallback. Compatibility is forward-only: an MVP build would discard a v1.1 history that contains the new evidence categories.

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
| (v1.2) stripe | 23.1.0 (API `2026-10-28.endive`, Node ≥ 20) | npm registry and package tarball read (research S1-S5); added by JM-202 |
| (v1.2) Stripe CLI | current release, installed by the owner | research S52-S58; not a package dependency |

**(v1.1)** No new runtime package is planned: image sniffing, the address policy, and the theme are small hand-written modules. JM-105 adds the shadcn registry items `card`, `aspect-ratio`, `skeleton`, and `item` with the pinned shadcn CLI 4.23.0. All four are listed in the `@shadcn` registry (checked with the shadcn MCP on 2026-11-21). If one pulls a new Radix package, JM-105 owns the `package.json` and lockfile change. The exa-js SDK passes the result `image` field through. The spike called the REST API directly, so JM-104's live smoke confirms this through `ExaSdkPort` (risk R-22).

(MVP, historical) JM-001 pinned exact versions in `package.json` and committed `pnpm-lock.yaml`. If a version above failed to install or build together, JM-001 could choose the nearest working release and must record it in its evidence; this is not a plan change unless an API used by this architecture disappears.

## Operations

- Start: `pnpm dev` (Vite on 127.0.0.1:5173 proxying `/api` to Hono on 127.0.0.1:8787) or `pnpm start` (build, then Hono serves the web build and API on 127.0.0.1:8787).
- Secrets: the server reads `EXA_API_KEY` with `process.loadEnvFile` from `.env.local`, or from the path in `EXA_ENV_FILE` (so a worktree can use the main checkout's file without copying it). The key never appears in the client bundle (no `VITE_` variable), logs, cache files, fixtures, or responses (EV-009).
- Network: the listen address is hard-coded to `127.0.0.1` (no host setting exists). The server rejects with 403 requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding guard), and any `POST` whose `Origin` is present and not one of those. Under `pnpm dev` (`KENSAKU_DEV=1`) the Vite origins `http://127.0.0.1:5173` and `http://localhost:5173` are also allowed; Vite's proxy keeps the original `Host` header.
- Modes: `KENSAKU_EXA_MODE=live` (default) or `fixture`. Fixture mode is accepted only when `NODE_ENV=test`. In fixture mode the UI shows a persistent "Fixture data" banner. There is no silent fallback from live to fixtures; Kensaku fails closed (ShopSense reference).
- Observability: one JSON log line per stage and per Exa call to stdout: run ID, stage, request count, cache hit, cost, duration, error kind. Query text is logged locally; the key and request headers never are.
- No deployment, auth, or remote storage (D-010).
- **(v1.1)** `.cache/images/` (gitignored with `.cache/`) holds image metadata and bytes. Deleting it is always safe: cards fall back until the next run registers images again. The live acceptance script starts each suite run with an empty image cache.
- **(v1.1)** Outbound traffic: Exa (as in the MVP) plus plain GETs to merchant and manufacturer image hosts named in this run's Exa results. There are no other hosts and no browser-side third-party requests.
- **(v1.2)** Use checkout at `http://127.0.0.1:8787` under `pnpm start`. Stripe returns to the fixed `127.0.0.1:<port>` URLs, so a session started from `localhost` or the Vite dev port returns to another origin (R-40).
- **(v1.2)** The server also calls `api.stripe.com` through the SDK (session create, retrieve, expire) when checkout is configured; webhooks arrive from the local Stripe CLI. `.data/commerce/` (new, gitignored) holds the simulated cart and orders; `.cache/offers/` holds offer snapshots. Deleting either resets the simulation. `README.md` documents the Stripe sandbox setup (EXECUTION_PLAN "Owner prerequisites").

## Simulated commerce (v1.2)

Evidence: `docs/futari/research/stripe-2026-11-23.md` (S1-S63, read from official docs, the `stripe@23.1.0` package, and the Stripe CLI source; no live Stripe call was made during planning, D-056). Decisions D-044 to D-057.

```
Browser (127.0.0.1)                    Node process (127.0.0.1:8787)                        Stripe sandbox
 Add to cart ── POST /api/cart/items ─▶ cart service ── offer registry (.cache/offers/)
 Checkout ───── POST /api/checkout ───▶ order + buildCheckoutSessionRequest ─ StripeCheckoutPort ─▶ sessions.create
            ◀─ { orderId, url } ───────
 location.assign(url) ─────────────────────────────────────────────────────────────────────────▶ hosted Checkout page
 ◀──────────── redirect to success_url / cancel_url ───────────────────────────────────────────── (owner pays or goes back)
 poll GET /api/orders/:id ────────────▶ commerce store (.data/commerce/state.json)
                                       POST /api/stripe/webhook ◀── stripe listen ◀──────────── event deliveries
                                         constructEvent(raw body) → dedupe → applyStripeEvent
```

### Modules

| Module | Responsibility | State |
| --- | --- | --- |
| `src/core/commerce.ts` | Pure rules: `offerId`, `toMinorUnits`, `applyCartOp` (EV-018 rules), `applyStripeEvent` (EV-020 transitions), the UI label strings. No I/O. | None |
| `src/commerce/port.ts` | `CheckoutPort { createSession(params, options): Promise<SessionResult>; expireSession(id): Promise<void>; retrieveSession(id): Promise<SessionResult> }` with `SessionResult { id, url, status, livemode, amountTotal, currency }` and typed errors (`session-not-open`, `stripe-error`). | None |
| `src/commerce/stripe-port.ts` | `StripeCheckoutPort`: the only importer of `stripe`. Builds the client with the pinned `apiVersion`, maps errors, refuses `livemode` results and non-`https://checkout.stripe.com/` URLs. Also exports `verifyWebhook(rawBody, header, secret)` wrapping `stripe.webhooks.constructEvent` (offline, tolerance 300 s) and `signTestPayload(payload, secret, timestamp)` wrapping `generateTestHeaderString`, for tests and the fake hosted page. | None |
| `src/commerce/fake-port.ts` | `FakeCheckoutPort` for tests: records calls, scripted outcomes (ok, error, livemode, session-not-open, custom url), and returns `http://127.0.0.1:<port>/__test/checkout/<id>` URLs. | In memory |
| `src/commerce/session-request.ts` | `buildCheckoutSessionRequest(order, { port, now })`: pure; owns the Stripe-facing strings ("Simulated: " prefix, descriptions); output frozen by EV-019. | None |
| `src/commerce/store.ts` | Load, validate (zod), and atomically save `.data/commerce/state.json`. | `.data/commerce/state.json` |
| `src/commerce/registry.ts` | `registerOffers(offers)` writes `.cache/offers/<id>.json` snapshots; `getOffer(id)`; prune after 30 days without registration. | `.cache/offers/` |
| `src/commerce/service.ts` | Cart operations, checkout, cancel, order reads; composes core rules, store, registry, and port. Owns the single serialized queue on which every commerce mutation runs, including its awaited port calls (port timeout 10 s), so a webhook arriving during a cancel or checkout is applied after it (EV-020 `serialization`). | Through the store |
| `src/commerce/webhook.ts` | The webhook handler: verify, livemode check, dedupe, match, `applyStripeEvent`, cart clearing, logging. | Through the store |
| `src/commerce/fake-hosted.ts` | Test-only routes, mounted only when `NODE_ENV=test` and fixture mode: `GET /__test/checkout/:id` with buttons "Pay", "Decline", and "Back", which sign (`signTestPayload`) and post webhooks with the test secret and redirect to the success or cancel URL; `POST /__test/commerce/reset` (empty cart and orders between specs), `/__test/commerce/checkout-configured { value }`, and `/__test/commerce/withhold-webhooks { value }` (EV-022 checks 9-10). | None |
| `src/server/` | Mounts the commerce routes behind the existing Host/Origin guard. `createApp` takes commerce as an optional dependency (existing test helpers keep compiling); `GET /api/health` is unchanged. | — |
| `src/web/app/` | Add-to-cart buttons, cart sheet, currency-replace dialog, checkout return panel, order list (EV-022). | Reads server state only |

### Data

```ts
// src/core/commerce.ts
type OrderState = "open" | "paid" | "cancelled" | "expired" | "payment_failed" | "failed";
interface RegisteredOffer { id: string; canonicalUrl: string; merchantHost: string; merchantName: string; productName: string;
  price: { amount: number; currency: Currency }; availability: Availability; exaRequestId: string; retrievedAt: string;
  market: Market; registeredAt: string }
interface CartLine { offerId: string; productName: string; merchantHost: string; quantity: number; demoUnitAmountMinor: number;
  observed: { amount: number; currency: Currency; retrievedAt: string; merchantHost: string } }
interface Cart { version: number; currency: Currency | null; lines: CartLine[] }   // version increments on every successful change
interface Order { orderId: string; state: OrderState; reason?: "superseded"; anomaly?: string; currency: Currency;
  lines: CartLine[]; totalMinor: number; cartVersion: number; stripeSessionId: string | null; expiresAt: string | null;
  declinedAttempts: number; awaitingAsyncPayment: boolean; createdAt: string; updatedAt: string;
  transitions: { at: string; from: OrderState | null; to: OrderState; eventId?: string }[] }
interface CommerceState { version: 1; cart: Cart; orders: Order[]; processedEvents: { id: string; at: string }[] }
```

`orderId` is `ord_` plus a random UUID. Orders are kept (simulated data, small); the UI lists the 10 newest.

The stream's `Offer` gains an optional `id` (the EV-018 `offerId`). JM-203 computes it in the pipeline's validate stage, registers the offer snapshot through an injected `registerOffers` callback (as `registerImages` works), and includes `id` in `data-products`. The field is optional, so `kensaku.history.v1` stays version 1 and older history still validates (D-040); offers without an id are not buyable (D-048).

### HTTP API (all JSON, behind the Host/Origin guard)

| Route | Body | Result |
| --- | --- | --- |
| `GET /api/cart` | — | `{ cart, totalMinor, checkoutConfigured }` (the only place the UI learns whether checkout is configured) |
| `POST /api/cart/items` | `{ offerId, quantity?, replace? }` (strict) | 200 `{ cart }`; 400/404/409/422 `{ code, details? }` with the EV-018 codes: `invalid-request` and `quantity-out-of-range` 400; `offer-not-registered` 404; `currency-mismatch` 409; `out-of-stock`, `below-minimum`, `quantity-limit`, `line-limit`, `total-too-large` 422 |
| `PATCH /api/cart/items/:offerId` | `{ quantity }` | as above; `not-in-cart` 404 |
| `DELETE /api/cart/items/:offerId` | — | 200 `{ cart }`; `not-in-cart` 404 |
| `DELETE /api/cart` | — | 200 empty cart |
| `POST /api/checkout` | `{}` | 200 `{ orderId, url }`; 400 `cart-empty`; 503 `checkout-not-configured`; 502 `checkout-failed` (EV-020 `checkout` rule) |
| `GET /api/orders` | — | the 10 newest orders (no Stripe ids beyond the session id) |
| `GET /api/orders/:id` | — | one order; 404 |
| `POST /api/orders/:id/cancel` | `{}` | EV-020 `cancel` rule |
| `POST /api/stripe/webhook` | raw Stripe event | EV-020 rules; reads the raw body before any JSON parsing |

The webhook route has no `Origin` (server-to-server through the CLI), so the existing guard passes it as long as `Host` is `127.0.0.1:<port>` (R-29). It never returns details of the order, only `{ outcome }`.

### Checkout flow

1. "Checkout in Stripe sandbox" posts `/api/checkout`. The service supersedes any open order (expire; on an expire error it retrieves the session and acts on its status, EV-020 `checkout` rule, D-057), creates the order (state `open`, the cart's lines and version copied), and calls `createSession` with the EV-019 request. A failure stores the order as `failed` and returns 502; the cart is untouched.
2. The client checks that the URL starts with `https://checkout.stripe.com/` (or, only in the fixture build used by tests, the local fake path) and calls `window.location.assign(url)`. The CSP is unchanged because a top-level navigation is not governed by `form-action` or `connect-src` (D-055).
3. Success: Stripe redirects to `/?checkout=success&order=<id>&session_id=<cs_…>`. The app shows the checkout return panel, verifies `session_id` equals the order's `stripeSessionId` (otherwise "Unknown checkout"), and polls `GET /api/orders/:id` every second. It shows "Confirming simulated payment…" until the order is paid; after 20 s it adds "Still waiting for Stripe's confirmation. Is `stripe listen` running?" and keeps polling at 5 s.
4. Cancel or decline: Stripe's back link goes to `/?checkout=cancelled&order=<id>`. The app calls `POST /api/orders/:id/cancel` (expire; on an expire error, retrieve: expired → cancelled, complete → 409 and the webhook decides) and shows "Simulated checkout cancelled. Your cart is unchanged." plus, best-effort, "The test card was declined." when `declinedAttempts ≥ 1` (R-30). Because this GET auto-posts cancel, a cross-site link that knew an order id could cancel an unpaid sandbox session; accepted (R-39).
   An open order whose `expiresAt` has passed stays open in the store and is labeled "Checkout link expired"; the next checkout supersedes it.
5. Webhook: verified events drive the state per EV-020; paid clears the cart only if its version still matches.
6. The app removes the `checkout`, `order`, and `session_id` query parameters with `history.replaceState` after reading them.

### Labels (REQ-022)

Fixed UI strings in `src/core/commerce.ts` (the Stripe-facing strings live in `src/commerce/session-request.ts` and are frozen by EV-019):

- Cart title "Simulated cart" and banner "Simulated purchase in a Stripe sandbox. No order is placed with any merchant and no real money moves."
- Per line: "Demo checkout price <amount> <code>" and, in muted text, "Last observed <amount> <code> on <host>, <local date and time>".
- Totals: "Demo total <amount> <code>". Button: "Checkout in Stripe sandbox".
- Paid: "Simulated payment received (Stripe sandbox). No order was placed with <host list>."
- Order badges: Simulated · Paid / Open / Cancelled / Expired / Payment failed / Failed.
- Never used anywhere in the UI: "Order confirmed", "Order placed", "Thank you for your order", "Purchase complete", "has shipped" (EV-022 checks).

### UI composition

- Components: shadcn `sheet` (new, installed with the pinned CLI, unmodified) for the cart; existing `button`, `badge`, `alert`, `alert-dialog` (currency replace), `item`, `separator`, `button-group` (quantity −/+), `tooltip`. No custom component library (D-018).
- Header: a cart button left of the theme toggle with the line count, `aria-label` "Open simulated cart, <n> items".
- Offer items (main list and Other markets): "Add to cart" button with `aria-label` "Add <product> from <host> to simulated cart". Disabled with a tooltip for offers without an id ("Ask again to buy"), out-of-stock offers ("Out of stock"), and below-minimum prices ("Below Stripe's minimum").
- After an add, the button's label changes to "Added" for 2 s and a polite live region announces "Added to simulated cart".
- Checkout is disabled when `checkoutConfigured` is false, with the text "Stripe sandbox is not configured. See README."
- Accessibility: keyboard-only operation, focus trapped in the sheet and returned to the trigger, `aria-live="polite"` for confirmation status, zero serious or critical axe violations in both themes.

### Configuration and keys

`parseConfig` adds `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (both optional, parsed into an optional `ServerConfig.stripe`, read from the same env file as `EXA_API_KEY`: `.env.local`, or the path in `EXA_ENV_FILE`). Rules (D-050): a key containing `_live_` or not starting with `sk_test_`, `rk_test_`, or `rkcs_test_` → `ConfigError` naming the variable, never its value; a webhook secret without `whsec_` → `ConfigError`; checkout is configured only when both are present. `AppConfig` is unchanged; the server passes `checkoutConfigured` to the commerce service, which reports it on `GET /api/cart`. The key reaches only the `Stripe` constructor; the secret only `verifyWebhook`. Fixture mode (`NODE_ENV=test`) uses `FakeCheckoutPort` and a test secret built at runtime; live Stripe is never contacted from tests.

### Observability

One JSON log line per commerce action: `cart` (op, result code), `checkout` (orderId, sessionId, result), `webhook` (eventId, type, outcome, orderId, from → to), `cancel`. Never keys, secrets, signature headers, card data, or full Stripe payloads.

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
| (v1.1) Browser hotlinks merchant image URLs | Rejected (owner, D-029) | Every result page would send third-party requests carrying the owner's IP and Referer, and the bytes and dimensions could not be checked. The proxy also lets history images survive the 6-hour Exa cache. |
| (v1.1) Image search engines, Exa image search, or generated images | Rejected | Extra cost or providers, weaker link to the product page, and generated images are forbidden. The `image` field of the pages Kensaku already validated is free and attributable. |
| (v1.1) Choosing the image server-side during the run (fetch every candidate before streaming) | Rejected | It adds up to 8 s to a run for a cosmetic result. The client tries candidates in order and the proxy validates each, so the stream stays fast and the skeleton is honest. |
| (v1.1) Deny rule over the whole image URL path | Rejected | It blocked real Courts photos under `/default/` (spike V-F9). |
| (v1.1) Excluding all offers outside the market currency | Rejected (owner, D-030) | It hides useful listings. They stay under a collapsed "Other markets". |
| (v1.1) shadcn ThemeProvider with a "system" option | Not adopted | The owner wants dark for every first-time visitor. The provider's effect-based class update also flashes. The same class convention with a blocking script meets both requirements. |
| (v1.1) Inline theme script with a CSP hash | Rejected | An external `public/theme-init.js` keeps `script-src 'self'` simple and stays correct if the script changes. |
| (v1.2) Stripe Elements or embedded Checkout | Rejected | Needs `js.stripe.com` scripts and frames, which breaks the `'self'`-only CSP and the "no third-party requests" rule; the owner asked for Stripe-hosted Checkout. |
| (v1.2) Payment Links or pre-created Products and Prices | Rejected | Prices come from each run's offers; inline `price_data` avoids creating catalog objects per offer. |
| (v1.2) Cart in browser `localStorage` | Rejected | Webhooks change orders while the browser is away, and the server must decide prices from its registry (D-048, D-053). |
| (v1.2) SQLite (`node:sqlite`) for orders | Rejected | Still experimental in Node 22 and unnecessary for one local user and a few dozen orders; one atomically written JSON file is enough (D-053). |
| (v1.2) Confirming payment by retrieving the session on the success page | Rejected (owner, D-047) | A second writer of the paid state; the verified webhook is the only source. Agents still use retrieve in EV-023 as an audit, not to change state. |
| (v1.2) `stripe-mock` in CI | Rejected | Stateless, hard-coded responses, no test-card errors; its own README recommends custom mocks (research S59-S61). |
| (v1.2) Playwright on the Stripe-hosted page | Rejected (owner, D-049) | Bot defenses and no stability promise; the owner performs those steps. |

## Vertical slice (v1.2)

The v1.2 slice (JM-201 commerce rules ∥ JM-202 Stripe adapter, then JM-203 server and minimal UI) proves the full purchase path through real boundaries before UI polish:

browser "Add to cart" on a live research result → `/api/cart/items` with a registry-checked offer → `/api/checkout` → `StripeCheckoutPort` → Stripe sandbox `sessions.create` → hosted Checkout page → owner pays with a test card → redirect to 127.0.0.1 → `stripe listen` → `/api/stripe/webhook` verified → order paid → the return panel shows the simulated payment.

Acceptance:

- In CI: an end-to-end Playwright test in fixture mode runs research → add → checkout → fake hosted page → signed webhook → paid, with zero requests to non-local origins.
- Locally (JM-203 sandbox smoke, ≤ 5 Exa requests, Q1): agent-run session create in USD, SGD, and JPY and expire (checks R-27, R-28, the 60-minute `expires_at`, the absent top-level `currency`, and the key permissions); a second expire of an expired session, recording the real error shape; one owner-paid USD purchase with 4242 marked paid only after the verified webhook; one owner decline then back, recording whether `payment_intent.payment_failed` arrives; one `stripe events resend` duplicate answered `duplicate`. Logs are committed under `.futari/evidence/live/`. A failure caused by a Stripe fact (R-27, R-28) stops execution for a plan revision.

## Vertical slice (v1.1, completed)

The v1.1 slice (JM-101 core rules, then JM-103 image proxy, then JM-104 pipeline and minimal UI) proves the riskiest new path through real boundaries before any card polish:

browser → `/api/chat` → pipeline with the market-aware query and extended `/answer` schema → live Exa → `src/core` v1.1 classification, image rules, and content → `data-products` with image candidates → `<img src="/api/image/:id">` → image proxy → a real merchant image host → rule I3 → the bytes shown in the product section.

Acceptance:

- The fixture end-to-end test shows an image loaded through the proxy, with zero requests to non-local origins.
- A live smoke of Q3 and Q4, at most 10 Exa requests, shows at least one SGD offer for each and at least one image loaded through the proxy. The logs are committed. US behaviour is covered by EV-016 (spike V4 showed no US regression).

The theme (JM-102) is independent and may run beside any one slice task, because their write scopes are disjoint. The full card design (JM-105) starts only after the slice and the theme are merged.

## Vertical slice (MVP, completed)

The first milestone (JM-001 to JM-004) proves the whole path through real boundaries: browser `useChat` → Hono `/api/chat` → research pipeline → `ExaSdkPort` (live Exa with the real key) → `src/core` classification → UI message stream → AI Elements conversation showing progress, a cited comparison, and an offer table with evidence listed separately. Acceptance: the fixture-backed end-to-end test passes, and a live smoke of Q1 (named model) and Q2 (open-ended, so Exa-generated `modelIdentifiers` are exercised) makes at most 10 requests in total; Q1 shows at least one merchant offer that passes revalidation, and the Q2 outcome (offers or an explicit no-offers state) is recorded. Both run logs are committed under `.futari/evidence/live/` at or before the evidence file's `Tested-Commit`. Market selection, history persistence, full error states, and accessibility polish follow in JM-005.
