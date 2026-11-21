// The owner audit sheet for one EV-016 run: every displayed offer and every displayed image, with the owner's columns empty.
import type { AnalyzedQuery } from "./types";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const money = (o: { price: { amount: number; currency: string } }) => `${o.price.amount} ${o.price.currency}`;

export interface AuditContext {
  runNumber: number;
  logFile: string;
  gitSha: string;
  imageDir: string;
  shotDir: string;
  auditRubric: string[];
  imageAuditRubric: string[];
}

export function renderAuditSheet(ctx: AuditContext, queries: readonly AnalyzedQuery[]): string {
  const offers = queries.flatMap((q) => q.analysis.offers);
  const images = queries.flatMap((q) => q.analysis.images);
  const offerRows = offers.map((o) => {
    const price = o.priceDisplay.pass ? `pass (${o.priceDisplay.detail})` : `FAIL: ${o.priceDisplay.detail}`;
    const placement = o.placement === "main" ? "main list" : o.placement === "other-markets" ? "Other markets" : "not shown";
    return `| ${o.id} | ${o.queryId} | ${cell(o.product)} | ${o.offer.merchantHost} | ${money(o.offer)} | ${o.offer.availability} | ${o.offer.canonicalUrl} | ${cell(o.offer.productName)} | ${placement} |  |  | ${cell(price)} |`;
  });
  const imageRows = images.map((i) => {
    const size = i.sniffed ? `${i.sniffed.width}x${i.sniffed.height} ${i.sniffed.type}, ${i.bytes} bytes` : "unreadable";
    return `| ${i.id} | ${i.queryId} | ${cell(i.product)} | ${i.sourceHost} | ${cell(i.sourceTitle)} | ${size} | ${i.file} | ${i.passes ? "pass" : `FAIL: ${cell(i.problem ?? "")}`} |  |`;
  });
  const queryLines = queries.map((q) => `- ${q.queryId} (${q.market}): ${q.finalState}, ${q.exaExchanges.length} request(s), ${q.analysis.offers.length} offer(s), ${q.analysis.images.length} image(s) displayed`);
  return [
    `# EV-016 run ${ctx.runNumber} owner audit sheet`,
    "",
    `Run log: .futari/evidence/live/${ctx.logFile} (git ${ctx.gitSha}).`,
    `Displayed image bytes (not committed): ${ctx.imageDir}. Full-page screenshots (not committed): ${ctx.shotDir}.`,
    "",
    "Offer rubric (evals/cases/live-acceptance-v1-1.json auditRubric):",
    ...ctx.auditRubric.map((r) => `- ${r}`),
    "",
    "Threshold: at least 90% of all displayed offers pass all three checks (main list and Other markets). Only the owner fills Right product and Direct merchant. Price display is prefilled by revalidation: the page's row equals the offer in the log, and the offer equals the summary Exa returned for that URL in this run.",
    "",
    "## Displayed offers",
    "",
    "| ID | Query | Card product | Merchant host | Price | Availability | URL | Page title (Exa) | Placement | Right product | Direct merchant | Price display |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...offerRows,
    "",
    `Total displayed offers: ${offers.length}.`,
    "",
    "## Displayed images",
    "",
    "Image rubric (imageAuditRubric):",
    ...ctx.imageAuditRubric.map((r) => `- ${r}`),
    "",
    "Threshold: failures allowed = max(1, floor(10% of displayed images)). The Revalidation column re-derives rules I1, I2 and I3 from the log.",
    "",
    "| ID | Query | Card product | Source host | Source title | Dimensions | File | Revalidation | Audit (Right product; Attributed) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...imageRows,
    "",
    `Total displayed images: ${images.length}.`,
    "",
    "## Queries",
    "",
    ...queryLines,
    "",
  ].join("\n");
}
