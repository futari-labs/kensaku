// Post-processing of one recorded EV-016 query (EVALUATION_PLAN "Live acceptance (EV-016)", runRules on revalidation).
// Everything here is derived from the raw record alone, so it can be rerun on a committed log:
//   - offers: reclassified from the recorded Exa response (tests/research/revalidate.ts) and compared with the page's rows;
//   - images: rules I1 and I2 re-derived from the recorded Exa response, rule I3 from the recorded proxy answer.
import { createHash } from "node:crypto";
import { canonicalizeUrl, classifyHit, imageBytesVerdict, rankImageCandidates } from "../../src/core";
import { merchantHostOf } from "../../src/core/url";
import type { Candidate, ImageCandidate, SearchHit } from "../../src/core/types";
import { parseSearchResponse } from "../../src/exa/parse";
import { buildSearchRequest } from "../../src/exa/requests";
import type { ProductResult } from "../../src/research/events";
import { AVAILABILITY_LABEL, formatPrice, productTitle } from "../../src/web/app/format";
import { revalidateRun } from "../../tests/research/revalidate";
import type { OfferCheck } from "../../tests/research/revalidate";
import type { AnalyzedQuery, AuditImage, AuditOffer, PriceDisplay, ProductImages, QueryAnalysis, QueryRecord } from "./types";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const EXTENSION = { jpeg: "jpg", png: "png", webp: "webp", avif: "avif", gif: "gif", unknown: "bin" } as const;

const idOf = (imageUrl: string) => createHash("sha256").update(imageUrl).digest("hex");
const hostOfPage = (pageUrl: string): string => {
  try {
    return merchantHostOf(new URL(pageUrl));
  } catch {
    return "";
  }
};

type Search = { exchange: QueryRecord["exaExchanges"][number]; parsed: ReturnType<typeof parseSearchResponse> };
const searchesOf = (q: QueryRecord): Search[] => q.exaExchanges.filter((e) => e.endpoint === "/search").map((exchange) => ({ exchange, parsed: parseSearchResponse(exchange.response) }));

/** Whether Exa's summary for the URL agrees with what the card showed; the rubric's "Price display" column. */
function priceDisplayOf(check: OfferCheck, searches: Search[], uiMatches: boolean): PriceDisplay {
  const { offer } = check;
  if (!uiMatches) return { pass: false, detail: "the page's row differs from the offer in the log" };
  const hit = searches.find((s) => s.parsed.exaRequestId === offer.exaRequestId)?.parsed.hits.find((h) => canonicalizeUrl(h.url) === offer.canonicalUrl);
  if (!hit?.summary) return { pass: false, detail: "no recorded summary for this URL" };
  const { price, currency, availability } = hit.summary;
  const problems: string[] = [];
  if (price !== offer.price.amount) problems.push(`Exa price ${price} vs shown ${offer.price.amount}`);
  if (currency !== undefined && currency.toUpperCase() !== offer.price.currency) problems.push(`Exa currency ${currency} vs shown ${offer.price.currency}`);
  if ((availability ?? "unknown") !== offer.availability) problems.push(`Exa availability ${availability ?? "unknown"} vs shown ${offer.availability}`);
  return problems.length === 0 ? { pass: true, detail: currency === undefined ? "equal (currency from the page's symbol)" : "equal" } : { pass: false, detail: problems.join("; ") };
}

function offersOf(q: QueryRecord, searches: Search[]): { offers: AuditOffer[]; problems: string[]; candidateProblems: string[] } {
  const products = q.displayed.products ?? [];
  const reval = revalidateRun({ queryId: q.queryId, finalState: q.finalState, exaExchanges: q.exaExchanges, displayed: { products } });
  const owners = products.flatMap((p) => p.offerGroups.flatMap((g) => g.offers.map(() => productTitle(p.candidate))));
  const ui = q.ui.products.flatMap((p) => p.offers);
  const claimed = new Set<number>();
  const offers = reval.offers.map((check, i): AuditOffer => {
    const { offer } = check;
    const at = ui.findIndex((row, j) => !claimed.has(j) && row.href === offer.canonicalUrl);
    const row = at === -1 ? undefined : ui[at];
    if (at !== -1) claimed.add(at);
    const uiMatches =
      row !== undefined && row.host === offer.merchantHost && row.price === formatPrice(offer.price.amount, offer.price.currency) && row.availability === AVAILABILITY_LABEL[offer.availability];
    return {
      id: `${q.queryId}-O${i + 1}`,
      queryId: q.queryId,
      product: owners[i] ?? "",
      offer,
      placement: row?.placement ?? "not shown",
      reproduced: check.reproduced,
      fromRun: check.fromRun,
      now: check.now,
      uiMatches,
      priceDisplay: priceDisplayOf(check, searches, uiMatches),
      problem: check.problem ?? (uiMatches ? undefined : `${offer.canonicalUrl}: the page's row is missing or differs`),
    };
  });
  const extra = ui.filter((_, j) => !claimed.has(j)).map((row) => `the page showed an offer row that is not in the log: ${row.href}`);
  return { offers, problems: extra, candidateProblems: reval.candidateProblems };
}

/** Rules I1 and I2 over the product's own recorded search, compared with the candidates the card was given and the proxy's registry. */
function derivedListProblems(product: ProductResult, searches: Search[], used: Set<Search>, market: QueryRecord["market"], probes: ProductImages | undefined): string[] {
  const title = productTitle(product.candidate);
  const candidate: Candidate = product.candidate;
  const query = buildSearchRequest(candidate, market).query;
  const search = searches.find((s) => !used.has(s) && (s.exchange.request as { query?: string }).query === query);
  if (search) used.add(search);
  let expected: { id: string; host: string; title: string; imageUrl: string; pageUrl: string }[] = [];
  if (search) {
    const hits: SearchHit[] = search.parsed.hits.map((hit) => ({ ...hit, retrievedAt: search.exchange.ts }));
    const runUrls = new Set(hits.map((h) => h.url));
    const classified = hits.map((hit) => ({ hit, result: classifyHit(hit, candidate, runUrls) }));
    expected = rankImageCandidates(classified, candidate, market).map((s) => ({ id: idOf(s.imageUrl), host: hostOfPage(s.pageUrl), title: s.sourceTitle, imageUrl: s.imageUrl, pageUrl: s.pageUrl }));
  }
  const shown: ImageCandidate[] = product.imageCandidates ?? [];
  const problems: string[] = [];
  if (expected.length !== shown.length) problems.push(`${title}: ${shown.length} image candidates shown, ${expected.length} re-derived`);
  expected.forEach((want, i) => {
    const got = shown[i];
    if (got && (got.id !== want.id || got.sourceHost !== want.host || got.sourceTitle !== want.title)) problems.push(`${title}: candidate ${i + 1} differs from the re-derived one`);
    const probe = probes?.candidates[i];
    // Keyed by image URL: when two cards share one, the registry keeps the last registration, so only the image URL is comparable.
    if (probe && probe.imageUrl !== want.imageUrl) problems.push(`${title}: candidate ${i + 1} registry entry differs from the recorded Exa result`);
  });
  return problems;
}

function imagesOf(q: QueryRecord, searches: Search[]): { images: AuditImage[]; listProblems: string[] } {
  const products = q.displayed.products ?? [];
  const used = new Set<Search>();
  const images: AuditImage[] = [];
  const listProblems: string[] = [];
  products.forEach((product, index) => {
    const probes = q.images[index];
    const title = productTitle(product.candidate);
    const problems = derivedListProblems(product, searches, used, q.market, probes);
    listProblems.push(...problems);
    const ui = q.ui.products[index];
    if (!probes?.loadedId || ui?.image.state !== "loaded") return;
    const at = probes.candidates.findIndex((c) => c.id === probes.loadedId);
    const probe = probes.candidates[at];
    if (!probe) {
      listProblems.push(`${title}: the page showed an image that is not one of the card's candidates`);
      return;
    }
    const sniffed = probe.sniffed;
    const verdict = sniffed ? imageBytesVerdict(sniffed, probe.bytes) : "no-dimensions";
    const issues: string[] = [];
    if (probe.status !== 200) issues.push(`proxy status ${probe.status}`);
    if (verdict !== "ok") issues.push(`rule I3: ${verdict}`);
    if (sniffed && probe.contentType !== `image/${sniffed.type}`) issues.push(`served as ${probe.contentType}, sniffed ${sniffed.type}`);
    if (probes.candidates.slice(0, at).some((c) => c.status === 200)) issues.push("an earlier candidate also loaded");
    if (ui.image.caption !== `Image: ${probe.sourceHost} · ${probe.sourceTitle}`.replace(/\s+/g, " ").trim()) issues.push("the caption does not name this candidate");
    if (problems.length > 0) issues.push("the candidate list does not re-derive");
    const n = images.length + 1;
    images.push({
      id: `${q.queryId}-I${n}`,
      candidateId: probe.id,
      queryId: q.queryId,
      product: title,
      sourceHost: probe.sourceHost,
      sourceTitle: probe.sourceTitle,
      imageUrl: probe.imageUrl,
      pageUrl: probe.pageUrl,
      sniffed,
      bytes: probe.bytes,
      file: `${q.queryId}-I${n}.${EXTENSION[sniffed?.type ?? "unknown"]}`,
      passes: issues.length === 0,
      problem: issues.length === 0 ? undefined : issues.join("; "),
    });
  });
  return { images, listProblems };
}

/** Where a displayed comparison or reason contains a brace (D-042): the page's text and the data it was drawn from. */
function bracesOf(q: QueryRecord): string[] {
  const found: string[] = [];
  const check = (where: string, text: string | null | undefined) => {
    if (text && /[{}]/.test(text)) found.push(where);
  };
  check("comparison (stream)", q.displayed.comparison?.text);
  q.ui.comparison.forEach((text, i) => check(`comparison paragraph ${i + 1} (page)`, text));
  (q.displayed.products ?? []).forEach((p, i) => check(`reason of card ${i + 1} (stream)`, p.reason?.renderedText));
  q.ui.products.forEach((p, i) => check(`reason of card ${i + 1} (page)`, p.reason?.text));
  return found;
}

export function analyzeQuery(q: QueryRecord): QueryAnalysis {
  const searches = searchesOf(q);
  const offers = offersOf(q, searches);
  const images = imagesOf(q, searches);
  const products = q.displayed.products ?? [];
  const offerIndexes = products.flatMap((p, i) => (p.offerGroups.some((g) => g.offers.length > 0) ? [i] : []));
  return {
    offers: offers.offers,
    images: images.images,
    imageListProblems: images.listProblems,
    candidateProblems: [...offers.candidateProblems, ...offers.problems],
    braces: bracesOf(q),
    offerCards: { total: offerIndexes.length, withImage: offerIndexes.filter((i) => q.ui.products[i]?.image.state === "loaded").length },
    nonLocalOrigins: q.browser.origins.filter((origin) => !LOCAL_HOSTS.has(new URL(origin).hostname)),
  };
}

export const analyze = (q: QueryRecord): AnalyzedQuery => ({ ...q, analysis: analyzeQuery(q) });
