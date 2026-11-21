import { segmentMarkers, splitParagraphs } from "../../core";
import type { CitedSource } from "../../core";
import type { SourceRef } from "../../research/events";
import { Badge } from "@/web/components/ui/badge";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/web/components/ai-elements/sources";
import { CitedSegments, MalformedNote } from "./Citation";
import { hostOf } from "./format";

/** A comparison source's `sourceId` lists the marker numbers that reached it, as "4,8". */
const citedSourceOf = ({ sourceId, url }: SourceRef): CitedSource => ({ url, numbers: sourceId.split(",").map(Number) });

function Paragraph({ text, sources }: { text: string; sources: CitedSource[] }) {
  const segments = segmentMarkers(text);
  const cited = segments.some((seg) => typeof seg !== "string");
  return (
    <p className="whitespace-pre-line" data-testid="comparison-paragraph" data-cited={cited}>
      <CitedSegments segments={segments} sources={sources} />
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
 * `text` is undefined when nothing readable remained; the note then stands in place of the comparison.
 */
export function Comparison({ text, truncated, sources }: { text: string | undefined; truncated: boolean; sources: SourceRef[] }) {
  const cited = sources.map(citedSourceOf);
  return (
    <section aria-labelledby="comparison-heading" className="space-y-4">
      <h2 id="comparison-heading" className="text-xl font-semibold">
        Comparison
      </h2>
      {text !== undefined && (
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed">
          {splitParagraphs(text).map((paragraph, i) => (
            <Paragraph key={i} text={paragraph} sources={cited} />
          ))}
        </div>
      )}
      {truncated && <MalformedNote />}
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
