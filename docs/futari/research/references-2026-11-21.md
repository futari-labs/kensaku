# Architectural references and frontend components (2026-11-21)

Research for D-015 and D-016. Sources were found with the Exa MCP `web_search_exa` tool (3 searches) and the public AI Elements registry. Kensaku does not copy code from these projects.

## Reference projects

The owner named Aria, ShopSense, and OpenShip. Each name matches several public projects, so the match chosen for each is stated, with its relevance.

### ShopSense: `github.com/Gauravkakde2005/Shopsense-AI` (closest match)

A "source-attributed shopping assistant" that compares offers "without inventing prices, reviews, or links". React + TypeScript + Vite + Tailwind front end, FastAPI back end, LangGraph stages (intent, discovery, review metadata, ranking, verification, explanation).

Adopted:

- **Fail closed.** Without live retrieval it returns a configuration error and never falls back to a demo catalog. Kensaku does the same: fixtures exist only in tests (REQ-005).
- **Provenance on every result.** Results are tagged `live_web` with retrieval timestamps and source links (matches D-006).
- **Explicit pipeline stages with a verification stage before explanation.** Kensaku's pipeline is candidates, offers, validation, comparison, and validation is deterministic code.

Not adopted: SerpApi Google Shopping (conflicts with D-004 and D-005); a separate LLM provider (conflicts with D-008).

Other ShopSense repositories: `Yasserelhaddar/ShopSense-AI` (three Python microservices, Qdrant, Redis, fine-tuned LLMs, scraping) shows the opposite of what a local single-user MVP needs. Its useful idea is opt-out activity tracking with a clear-history control, which matches D-016. `Om-5640/shopsense` adds a domain blacklist after repeated failures and stage caching with a TTL; Kensaku adopts a static aggregator/editorial domain list and response caching.

### Aria: ambiguous, two plausible matches

- **Aria Labs** (`arialabsai.com/product-research-automation`): product research automation that turns repeated research into "structured, human-reviewable" patterns. Adopted idea: a fixed, inspectable research procedure (the same stages and output shape every run) rather than an open-ended agent loop. This supports deterministic tests and a stable request budget.
- **ariaonline.com agent instructions** (Shopify UCP storefront): agents should use the buyer's country and currency for pricing, back off on HTTP 429 and respect `Retry-After`, and never complete purchases without buyer authorization. Adopted: market-aware currency (D-014), 429 handling (REQ-005). Checkout is a non-goal.

**Owner confirmation needed:** if a different "Aria" was intended, the architecture does not depend on it; tell me and I will review it as a plan revision.

### OpenShip: `github.com/oblien/openship`

An Apache-2.0 self-hosted deployment platform (control plane, OpenResty edge, Let's Encrypt). It is relevant only to the future deployment milestone, which the MVP excludes (D-010). Adopted now: apps are published on loopback only, never on a public port (REQ-007). Recorded for later: frozen build snapshots for reproducible redeploys.

## Frontend components

### shadcn MCP

- The installed shadcn MCP resolved `@shadcn/table` (registry:ui, depends on `cn`) and `@shadcn/badge` (depends on `cn`, `radix-ui`).
- Search and list calls need a `components.json`, which does not exist before scaffolding. `@ai-elements` is not configured yet, so `view_items_in_registries` returned `NOT_CONFIGURED`. JM-001 creates `components.json` with the `@ai-elements` registry and uses the MCP for discovery and its audit checklist from then on.

### AI Elements registry (`https://registry.ai-sdk.dev/registry.json`)

77 items: 30 components plus examples. Components Kensaku plans to use, with dependencies read from each item's registry JSON:

| Component | npm deps | shadcn deps | Kensaku use |
| --- | --- | --- | --- |
| `conversation` | lucide-react, use-stick-to-bottom | button | Scrolling chat thread |
| `message` | ai, lucide-react, streamdown | button, button-group, tooltip | User and assistant turns, streamed text |
| `prompt-input` | ai, lucide-react, nanoid | button, command, dropdown-menu, hover-card, input-group, select | Question input and submit |
| `suggestion` | none | button, scroll-area | Example questions in the empty state |
| `task` | lucide-react | collapsible | Research progress stages |
| `inline-citation` | lucide-react | badge, carousel, hover-card | `[n]` citation markers in the comparison |
| `sources` | lucide-react | collapsible | Source list and labeled research evidence |
| `shimmer` | motion | none | Running-state text |

shadcn/ui components used directly: `table` (offer table), `badge` (availability and currency), `select` (market), `alert-dialog` (clear-history confirmation), `alert` (error and price notice).

`message` and `prompt-input` import types from the `ai` package, so the client uses `@ai-sdk/react` `useChat`. `ai@7.0.178` exports `createUIMessageStream` and `createUIMessageStreamResponse` with `source-url` and `data-*` parts. The server can therefore stream Exa-derived content in the AI SDK UI message protocol without configuring any LLM provider, which keeps D-008.

Policy (D-015): components are installed with the shadcn CLI from the official registries and are not edited. Kensaku composes them in its own files. An evaluation (EV-007) compares installed component files with the registry content recorded at install time.

Current npm versions observed: ai 7.0.178, @ai-sdk/react 4.0.182, exa-js 2.29.0, hono 4.13.19, @hono/node-server 2.1.11, vite 8.3.8, react 19.3.1, tailwindcss 4.3.5, shadcn 4.23.0, vitest 5.1.1, @playwright/test 1.65.1, @axe-core/playwright 4.14.0, zod 4.6.7, typescript 7.0.2.
