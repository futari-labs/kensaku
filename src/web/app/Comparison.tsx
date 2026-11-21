import { Fragment } from "react";
import { segmentMarkers, splitParagraphs } from "../../core";
import type { SourceRef } from "../../research/events";
import { Popover } from "radix-ui";
import { Badge } from "@/web/components/ui/badge";
import { InlineCitation, InlineCitationSource } from "@/web/components/ai-elements/inline-citation";
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

/**
 * An inline citation is a button that opens its sources as links. The generated hover card opens on
 * hover or focus only and its content is out of the tab order, so this composes the generated
 * citation pieces around a click-to-open popover that the keyboard can reach and operate.
 */
function Citation({ urls }: { urls: string[] }) {
  const hosts = urls.map(hostOf);
  return (
    <InlineCitation>
      <Popover.Root>
        <Popover.Trigger asChild>
          <Badge asChild variant="secondary" className="ml-1 cursor-pointer rounded-full">
            <button type="button" data-testid="inline-citation">
              <span className="sr-only">Citation: </span>
              {hosts[0]}
              {urls.length > 1 && ` +${urls.length - 1}`}
            </button>
          </Badge>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={4}
            data-testid="citation-card"
            aria-label={`Sources: ${hosts.join(", ")}`}
            className="z-50 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden"
          >
            {urls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" data-testid="citation-link" className="block rounded-sm underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <InlineCitationSource title={hostOf(url)} url={url} />
              </a>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </InlineCitation>
  );
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
        return <Citation key={i} urls={urls} />;
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
