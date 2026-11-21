import { useId, useState } from "react";
import { ChevronDownIcon, ImageOffIcon } from "lucide-react";
import { segmentMarkers } from "../../core";
import { MARKET_CURRENCY } from "../../core/currency";
import type { Evidence, ImageCandidate, Market, Offer } from "../../core/types";
import type { ProductResult } from "../../research/events";
import { AspectRatio } from "@/web/components/ui/aspect-ratio";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/web/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemHeader, ItemTitle } from "@/web/components/ui/item";
import { Skeleton } from "@/web/components/ui/skeleton";
import { cn } from "@/web/lib/utils";
import { CitedSegments, MalformedNote } from "./Citation";
import { AVAILABILITY_LABEL, EVIDENCE_LABEL, formatPrice, formatTime, productTitle } from "./format";
import { MARKET_NAME } from "./markets";
import { offerView } from "./offers";
import type { OfferView } from "./offers";

const IMAGE_RATIO = 4 / 3;

/**
 * The first candidate that loads, through the local proxy. A candidate that fails (rule I3, upstream, unknown id) is
 * skipped, and the caption names the one that actually loaded. Nothing loadable, or no candidates at all, shows a panel
 * of the same size.
 */
function ProductImage({ label, candidates }: { label: string; candidates: ImageCandidate[] }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const current = candidates[index];
  if (!current) {
    return (
      <figure data-testid="product-image">
        <AspectRatio ratio={IMAGE_RATIO} data-testid="no-image" className="flex flex-col items-center justify-center gap-2 bg-muted text-sm text-foreground">
          <ImageOffIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          No verified product image
        </AspectRatio>
      </figure>
    );
  }
  return (
    <figure data-testid="product-image" data-loaded={loaded}>
      <AspectRatio ratio={IMAGE_RATIO} className="bg-muted">
        {!loaded && <Skeleton className="absolute inset-0 rounded-none" data-testid="image-skeleton" />}
        <img
          key={current.id}
          src={`/api/image/${current.id}`}
          alt={`${label}, image from ${current.sourceHost}`}
          className={cn("size-full object-contain", !loaded && "opacity-0")}
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((i) => i + 1)}
        />
      </AspectRatio>
      <figcaption className="line-clamp-2 min-h-5 px-(--card-spacing) pt-2 text-xs text-muted-foreground" data-testid="image-caption">
        {loaded && `Image: ${current.sourceHost} · ${current.sourceTitle}`}
      </figcaption>
    </figure>
  );
}

function OfferItem({ offer }: { offer: Offer }) {
  return (
    <Item variant="outline" size="sm" role="listitem" data-testid="offer-row">
      <ItemHeader>
        <ItemTitle>{offer.merchantHost}</ItemTitle>
        <span className="text-base font-semibold whitespace-nowrap tabular-nums">{formatPrice(offer.price.amount, offer.price.currency)}</span>
      </ItemHeader>
      <ItemContent className="basis-full sm:basis-0">
        <ItemDescription className="line-clamp-none">
          {offer.merchantName} · <time dateTime={offer.retrievedAt}>{formatTime(offer.retrievedAt)}</time>
        </ItemDescription>
      </ItemContent>
      <ItemActions className="w-full justify-between sm:w-auto sm:justify-start">
        <Badge variant="secondary">{AVAILABILITY_LABEL[offer.availability]}</Badge>
        <Button asChild variant="outline" size="sm">
          <a href={offer.canonicalUrl} target="_blank" rel="noopener noreferrer" aria-label={`View offer for ${offer.productName} at ${offer.merchantHost}`}>
            View offer
          </a>
        </Button>
      </ItemActions>
    </Item>
  );
}

function OfferList({ offers, label }: { offers: Offer[]; label: string }) {
  return (
    <ItemGroup aria-label={label}>
      {offers.map((offer) => (
        <OfferItem key={offer.canonicalUrl} offer={offer} />
      ))}
    </ItemGroup>
  );
}

/** A disclosure that is closed until the reader opens it; the trigger carries `aria-expanded`. */
function Disclosure({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <Collapsible data-testid={testId} className="space-y-3">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="outline" className="group h-auto min-h-9 w-full justify-between py-2 whitespace-normal">
          <span className="text-left">{title}</span>
          <ChevronDownIcon aria-hidden="true" className="transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ResearchDetails({ evidence, rejected }: { evidence: Evidence[]; rejected: number }) {
  return (
    <Disclosure title="Research details" testId="research-details">
      <div className="space-y-3 text-sm" data-testid="evidence">
        {evidence.length > 0 && (
          <>
            <h4 className="font-semibold">Research evidence (not merchant offers)</h4>
            <ul className="space-y-3">
              {evidence.map((item) => (
                <li key={item.url} data-testid="evidence-item">
                  <a className="break-words underline underline-offset-2" href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.title ?? item.url}
                  </a>
                  <div className="text-xs text-muted-foreground">
                    {EVIDENCE_LABEL[item.category]}
                    {item.reportedPrice ? ` · ${item.reportedPrice.amount} ${item.reportedPrice.currency} reported by ${item.host}; not a merchant offer` : ` · ${item.host}; not a merchant offer`}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {/* EV-015 check 7 asks for the rejected count, so it shows even at zero. */}
        <p className="text-xs text-muted-foreground">
          {rejected} search result{rejected === 1 ? " was" : "s were"} rejected as not matching this product.
        </p>
      </div>
    </Disclosure>
  );
}

/** The one place the card branches on its offers: the summary line under the image and the offer lists below the reason. */
function offerSections(view: OfferView): { summary: React.ReactNode; listing: React.ReactNode } {
  switch (view.kind) {
    case "notSearched":
      return { summary: null, listing: <p className="text-sm text-muted-foreground">{view.message}</p> };
    case "none":
      return {
        summary: null,
        listing: (
          <p className="text-sm" data-testid="no-offers">
            No direct merchant offers with a listed price were found.
          </p>
        ),
      };
    case "offers": {
      const { market, local, lowest, other, otherCount } = view;
      const name = MARKET_NAME[market];
      return {
        summary:
          lowest === undefined ? (
            <p className="text-base font-medium text-muted-foreground" data-testid="price-summary">
              No {name} offers found
            </p>
          ) : (
            <p className="text-base" data-testid="price-summary">
              <span className="text-xl font-semibold tabular-nums">From {formatPrice(lowest, MARKET_CURRENCY[market])}</span>
              <span className="text-muted-foreground">
                {" · "}
                {local.length} {name} {local.length === 1 ? "offer" : "offers"}
              </span>
            </p>
          ),
        listing: (
          <>
            {local.length > 0 && (
              <section aria-label={`${name} offers`} data-testid="offers">
                <OfferList offers={local} label={`${name} offers`} />
              </section>
            )}
            {otherCount > 0 && (
              <Disclosure title={`Other markets (may not ship to ${name}) · ${otherCount}`} testId="other-markets">
                {other.map((group) => (
                  <div key={group.currency} className="space-y-2">
                    <p className="text-xs text-muted-foreground">Prices in {group.currency}</p>
                    <OfferList offers={group.offers} label={`Offers in ${group.currency}`} />
                  </div>
                ))}
              </Disclosure>
            )}
          </>
        ),
      };
    }
  }
}

/** `market` is the market the run was for, settled once per turn (`turnsOf`). */
export function ProductCard({ product, market }: { product: ProductResult; market: Market | undefined }) {
  const { candidate, evidence, rejectedCounts, keySpecs, reason, imageCandidates } = product;
  const title = productTitle(candidate);
  const headingId = useId();
  const reasonId = useId();
  const rejected = Object.values(rejectedCounts).reduce((a, b) => a + b, 0);
  const { summary, listing } = offerSections(offerView(product, market));

  return (
    <Card role="article" aria-labelledby={headingId} data-testid="product" className="gap-5 pt-5 pb-6 [--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardTitle className="text-xl leading-tight font-semibold">
          <h3 id={headingId}>{title}</h3>
        </CardTitle>
      </CardHeader>
      <ProductImage label={title} candidates={imageCandidates ?? []} />
      <CardContent className="space-y-6">
        {summary}
        {keySpecs !== undefined && keySpecs.length > 0 && (
          <ul className="list-disc space-y-1.5 pl-5 text-sm marker:text-muted-foreground" aria-label="Key specifications" data-testid="key-specs">
            {keySpecs.map((spec) => (
              <li key={spec}>{spec}</li>
            ))}
          </ul>
        )}
        {reason && (
          <section aria-labelledby={reasonId} className="space-y-2" data-testid="reason">
            <h4 id={reasonId} className="text-sm font-semibold">
              Why it fits
            </h4>
            <p className="text-sm leading-relaxed">
              <CitedSegments segments={segmentMarkers(reason.renderedText)} sources={reason.citedSources} />
            </p>
            {reason.truncated && <MalformedNote />}
          </section>
        )}
        {listing}
        <ResearchDetails evidence={evidence} rejected={rejected} />
      </CardContent>
    </Card>
  );
}
