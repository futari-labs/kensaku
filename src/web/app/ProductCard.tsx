import { useId, useState } from "react";
import { ChevronDownIcon, ImageOffIcon } from "lucide-react";
import { segmentMarkers } from "../../core";
import type { CitedSource } from "../../core";
import type { Evidence, ImageCandidate, Market, Offer, OfferGroup } from "../../core/types";
import type { ProductResult } from "../../research/events";
import { AspectRatio } from "@/web/components/ui/aspect-ratio";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/web/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemHeader, ItemTitle } from "@/web/components/ui/item";
import { Skeleton } from "@/web/components/ui/skeleton";
import { cn } from "@/web/lib/utils";
import { CitedSegments } from "./Citation";
import { MalformedNote } from "./Comparison";
import { AVAILABILITY_LABEL, EVIDENCE_LABEL, formatPrice, formatTime } from "./format";
import { MARKET_INFO } from "./markets";

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

const OfferList = ({ offers, label }: { offers: Offer[]; label: string }) => (
  <ItemGroup aria-label={label}>
    {offers.map((offer) => (
      <OfferItem key={offer.canonicalUrl} offer={offer} />
    ))}
  </ItemGroup>
);

/** A disclosure that is closed until the reader opens it; the trigger carries `aria-expanded`. */
function Disclosure({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <Collapsible data-testid={testId} className="space-y-3">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="outline" className="h-auto min-h-9 w-full justify-between py-2 whitespace-normal [&[aria-expanded=true]>svg]:rotate-180">
          <span className="text-left">{title}</span>
          <ChevronDownIcon aria-hidden="true" className="transition-transform" />
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
        {evidence.length > 0 && <h4 className="font-semibold">Research evidence (not merchant offers)</h4>}
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
        <p className="text-xs text-muted-foreground">
          {rejected} search result{rejected === 1 ? " was" : "s were"} rejected as not matching this product.
        </p>
      </div>
    </Disclosure>
  );
}

/** Which number each marker stands for, resolved to this reason's sources (the comparison's marker numbers, kept by `resolveReason`). */
const reasonUrlsFor = (cited: CitedSource[]) => (numbers: number[]) => {
  const urls: string[] = [];
  for (const n of numbers) {
    const source = cited.find((s) => s.numbers.includes(n));
    if (source && !urls.includes(source.url)) urls.push(source.url);
  }
  return urls;
};

/** The market the run was for. History from before v1.1 did not record it, and the market's currency leads its offer groups. */
const marketOf = (groups: OfferGroup[], recorded: Market | undefined): Market | undefined =>
  recorded ?? (Object.keys(MARKET_INFO) as Market[]).find((m) => MARKET_INFO[m].currency === groups[0]?.currency);

function PriceSummary({ offers, market }: { offers: Offer[]; market: Market }) {
  const { name, currency } = MARKET_INFO[market];
  if (offers.length === 0) return <p className="text-base font-medium text-muted-foreground" data-testid="price-summary">No {name} offers found</p>;
  // The lowest listed price counts out-of-stock offers too; their badge stays visible in the list.
  const lowest = Math.min(...offers.map((o) => o.price.amount));
  return (
    <p className="text-base" data-testid="price-summary">
      <span className="text-xl font-semibold tabular-nums">From {formatPrice(lowest, currency)}</span>
      <span className="text-muted-foreground">
        {" · "}
        {offers.length} {name} {offers.length === 1 ? "offer" : "offers"}
      </span>
    </p>
  );
}

export function ProductCard({ product, market }: { product: ProductResult; market: Market | undefined }) {
  const { candidate, offerGroups, evidence, rejectedCounts, notSearched, keySpecs, reason, imageCandidates } = product;
  const title = `${candidate.brand} ${candidate.name}`;
  const headingId = useId();
  const rejected = Object.values(rejectedCounts).reduce((a, b) => a + b, 0);
  const resolved = marketOf(offerGroups, market);
  const local = resolved ? (offerGroups.find((g) => g.currency === MARKET_INFO[resolved].currency)?.offers ?? []) : [];
  const other = offerGroups.filter((g) => !resolved || g.currency !== MARKET_INFO[resolved].currency);
  const otherCount = other.reduce((n, g) => n + g.offers.length, 0);
  const reasonId = useId();

  return (
    <Card role="article" aria-labelledby={headingId} data-testid="product" className="gap-5 pt-5 pb-6 [--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardTitle className="text-xl leading-tight font-semibold">
          <h3 id={headingId}>{title}</h3>
        </CardTitle>
      </CardHeader>
      <ProductImage label={title} candidates={imageCandidates ?? []} />
      <CardContent className="space-y-6">
        {notSearched === undefined && resolved && offerGroups.length > 0 && <PriceSummary offers={local} market={resolved} />}
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
              <CitedSegments segments={segmentMarkers(reason.renderedText)} urlsFor={reasonUrlsFor(reason.citedSources)} />
            </p>
            {reason.truncated && <MalformedNote />}
          </section>
        )}
        {notSearched !== undefined && <p className="text-sm text-muted-foreground">{notSearched}</p>}
        {notSearched === undefined && offerGroups.length === 0 && (
          <p className="text-sm" data-testid="no-offers">
            No direct merchant offers with a listed price were found.
          </p>
        )}
        {local.length > 0 && resolved && (
          <section aria-label={`${MARKET_INFO[resolved].name} offers`} data-testid="offers">
            <OfferList offers={local} label={`${MARKET_INFO[resolved].name} offers`} />
          </section>
        )}
        {otherCount > 0 && resolved && (
          <Disclosure title={`Other markets (may not ship to ${MARKET_INFO[resolved].name}) · ${otherCount}`} testId="other-markets">
            {other.map((group) => (
              <div key={group.currency} className="space-y-2">
                <p className="text-xs text-muted-foreground">Prices in {group.currency}</p>
                <OfferList offers={group.offers} label={`Offers in ${group.currency}`} />
              </div>
            ))}
          </Disclosure>
        )}
        <ResearchDetails evidence={evidence} rejected={rejected} />
      </CardContent>
    </Card>
  );
}
