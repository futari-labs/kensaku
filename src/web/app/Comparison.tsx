import { Fragment } from "react";
import { segmentMarkers, splitParagraphs } from "../../core";
import type { SourceRef } from "../../research/events";
import { Badge } from "@/web/components/ui/badge";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationSource,
} from "@/web/components/ai-elements/inline-citation";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/web/components/ai-elements/sources";
import { hostOf } from "./format";

function urlsFor(numbers: number[], sources: SourceRef[]): string[] {
  const urls: string[] = [];
  for (const n of numbers) {
    const source = sources.find((s) => s.sourceId.split(",").includes(String(n)));
    if (source && !urls.includes(source.url)) urls.push(source.url);
  }
  return urls;
}

function Paragraph({ text, sources }: { text: string; sources: SourceRef[] }) {
  const segments = segmentMarkers(text);
  const cited = segments.some((seg) => typeof seg !== "string");
  return (
    <p className="whitespace-pre-line" data-testid="comparison-paragraph" data-cited={cited}>
      {segments.map((seg, i) => {
        if (typeof seg === "string") return <Fragment key={i}>{seg}</Fragment>;
        const urls = urlsFor(seg.citation, sources);
        if (urls.length === 0) return <Fragment key={i}>[{seg.citation.join(",")}]</Fragment>;
        return (
          <InlineCitation key={i}>
            <InlineCitationCard>
              <InlineCitationCardTrigger sources={urls} data-testid="inline-citation" />
              <InlineCitationCardBody>
                <div className="space-y-3 p-4">
                  {urls.map((url) => (
                    <InlineCitationSource key={url} title={hostOf(url)} url={url} />
                  ))}
                </div>
              </InlineCitationCardBody>
            </InlineCitationCard>
          </InlineCitation>
        );
      })}
      {!cited && (
        <Badge variant="outline" className="ml-2" data-testid="uncited-flag">
          Uncited
        </Badge>
      )}
    </p>
  );
}

/**
 * The comparison text with its citation markers as inline citations. Paragraphs come from the same
 * `splitParagraphs` that numbers `uncitedParagraphs`, and a paragraph with no marker is flagged uncited.
 */
export function Comparison({ text, sources }: { text: string; sources: SourceRef[] }) {
  return (
    <section aria-labelledby="comparison-heading" className="space-y-3">
      <h2 id="comparison-heading" className="text-lg font-semibold">
        Comparison
      </h2>
      <div className="space-y-3 text-sm leading-relaxed">
        {splitParagraphs(text).map((paragraph, i) => (
          <Paragraph key={i} text={paragraph} sources={sources} />
        ))}
      </div>
      {sources.length > 0 && (
        <Sources>
          <SourcesTrigger count={sources.length} />
          <SourcesContent>
            {sources.map((s) => (
              <Source key={s.url} href={s.url} title={hostOf(s.url)} data-testid="source-link" />
            ))}
          </SourcesContent>
        </Sources>
      )}
    </section>
  );
}
