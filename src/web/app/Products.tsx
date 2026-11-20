import type { Evidence, Offer } from "../../core/types";
import type { ProductResult } from "../../research/events";
import { Badge } from "@/web/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table";
import { AVAILABILITY_LABEL, EVIDENCE_LABEL, formatPrice, formatTime } from "./format";

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
                aria-label={`View ${offer.productName} at ${offer.merchantHost}`}
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

function Product({ product }: { product: ProductResult }) {
  const { candidate, offerGroups, evidence, rejectedCounts, notSearched } = product;
  const rejected = Object.values(rejectedCounts).reduce((a, b) => a + b, 0);
  return (
    <article className="space-y-3 rounded-lg border p-4" data-testid="product" aria-label={`${candidate.brand} ${candidate.name}`}>
      <h3 className="text-base font-semibold">
        {candidate.brand} {candidate.name}
      </h3>
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
