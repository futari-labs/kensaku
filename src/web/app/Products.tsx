import { useState } from "react";
import type { Evidence, ImageCandidate, Offer } from "../../core/types";
import type { ProductResult } from "../../research/events";
import { Badge } from "@/web/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table";
import { AVAILABILITY_LABEL, EVIDENCE_LABEL, formatPrice, formatTime, hostOf, MALFORMED_NOTE } from "./format";

function OfferTable({ currency, offers }: { currency: string; offers: Offer[] }) {
  return (
    <Table data-testid="offer-table">
      <caption className="mb-2 text-left text-xs text-muted-foreground">Prices in {currency}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Merchant</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>Availability</TableHead>
          <TableHead>Retrieved</TableHead>
          <TableHead>Link</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {offers.map((offer) => (
          <TableRow key={offer.canonicalUrl} data-testid="offer-row">
            <TableCell>
              <div className="font-medium">{offer.merchantHost}</div>
              <div className="text-xs text-muted-foreground">{offer.merchantName}</div>
            </TableCell>
            <TableCell className="whitespace-nowrap">{formatPrice(offer.price.amount, offer.price.currency)}</TableCell>
            <TableCell>
              <Badge variant="secondary">{AVAILABILITY_LABEL[offer.availability]}</Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <time dateTime={offer.retrievedAt}>{formatTime(offer.retrievedAt)}</time>
            </TableCell>
            <TableCell>
              <a
                className="underline underline-offset-2"
                href={offer.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View offer for ${offer.productName} at ${offer.merchantHost}`}
              >
                View offer
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <section aria-label="Research evidence" className="space-y-2" data-testid="evidence">
      <h4 className="text-sm font-semibold">Research evidence (not merchant offers)</h4>
      <ul className="space-y-2 text-sm">
        {evidence.map((item) => (
          <li key={item.url} data-testid="evidence-item">
            <a className="underline underline-offset-2" href={item.url} target="_blank" rel="noopener noreferrer">
              {item.title ?? item.url}
            </a>
            <div className="text-xs text-muted-foreground">
              {EVIDENCE_LABEL[item.category]}
              {item.reportedPrice && ` · ${item.reportedPrice.amount} ${item.reportedPrice.currency} reported by ${item.host}; not a merchant offer`}
              {!item.reportedPrice && ` · ${item.host}; not a merchant offer`}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The first candidate that loads, through the local proxy. A candidate that fails (rule I3, upstream, unknown id) is skipped. */
function ProductImage({ label, candidates }: { label: string; candidates: ImageCandidate[] }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const current = candidates[index];
  if (!current) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm" data-testid="no-image">
        No verified product image
      </p>
    );
  }
  return (
    <figure className="space-y-1" data-testid="product-image" data-loaded={loaded}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
        {!loaded && <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" data-testid="image-skeleton" />}
        <img
          key={current.id}
          src={`/api/image/${current.id}`}
          alt={label}
          className="size-full object-contain"
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((i) => i + 1)}
        />
      </div>
      {loaded && (
        <figcaption className="text-xs text-muted-foreground" data-testid="image-caption">
          Image from {current.sourceHost}: {current.sourceTitle}
        </figcaption>
      )}
    </figure>
  );
}

function Product({ product }: { product: ProductResult }) {
  const { candidate, offerGroups, evidence, rejectedCounts, notSearched, keySpecs, reason, imageCandidates } = product;
  const rejected = Object.values(rejectedCounts).reduce((a, b) => a + b, 0);
  return (
    <article className="space-y-3 rounded-lg border p-4" data-testid="product" aria-label={`${candidate.brand} ${candidate.name}`}>
      <h3 className="text-base font-semibold">
        {candidate.brand} {candidate.name}
      </h3>
      {imageCandidates !== undefined && <ProductImage label={`${candidate.brand} ${candidate.name}`} candidates={imageCandidates} />}
      {keySpecs !== undefined && keySpecs.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm" aria-label="Key specifications" data-testid="key-specs">
          {keySpecs.map((spec) => (
            <li key={spec}>{spec}</li>
          ))}
        </ul>
      )}
      {reason && (
        <section aria-label="Why it fits" className="space-y-1 text-sm" data-testid="reason">
          <p>{reason.renderedText}</p>
          {reason.truncated && <p className="text-xs text-muted-foreground">{MALFORMED_NOTE}</p>}
          {reason.sources.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Sources:{" "}
              {reason.sources.map((url, i) => (
                <span key={url}>
                  {i > 0 && ", "}
                  <a className="underline underline-offset-2" href={url} target="_blank" rel="noopener noreferrer">
                    {hostOf(url)}
                  </a>
                </span>
              ))}
            </p>
          )}
        </section>
      )}
      {notSearched !== undefined && <p className="text-sm text-muted-foreground">{notSearched}</p>}
      {offerGroups.map((group) => (
        <OfferTable key={group.currency} currency={group.currency} offers={group.offers} />
      ))}
      {notSearched === undefined && offerGroups.length === 0 && (
        <p className="text-sm" data-testid="no-offers">
          No direct merchant offers with a listed price were found.
        </p>
      )}
      {evidence.length > 0 && <EvidenceList evidence={evidence} />}
      {rejected > 0 && <p className="text-xs text-muted-foreground">{rejected} search result(s) were rejected as not matching this product.</p>}
    </article>
  );
}

/** One section per product: offer tables by currency, then labeled evidence. */
export function Products({ products }: { products: ProductResult[] }) {
  if (products.length === 0) {
    return <p className="text-sm text-muted-foreground">No candidate products were identified for this question.</p>;
  }
  return (
    <section aria-labelledby="products-heading" className="space-y-4">
      <h2 id="products-heading" className="text-lg font-semibold">
        Where to buy
      </h2>
      <p className="text-xs text-muted-foreground" data-testid="last-observed-notice">
        Prices and availability were last observed by Exa and must be confirmed on the merchant&apos;s page.
      </p>
      {products.map((product) => (
        <Product key={product.candidate.name} product={product} />
      ))}
    </section>
  );
}
