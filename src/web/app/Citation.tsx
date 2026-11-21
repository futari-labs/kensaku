import { Fragment } from "react";
import { Popover } from "radix-ui";
import type { CitedSource, MarkerSegment } from "../../core";
import { Badge } from "@/web/components/ui/badge";
import { InlineCitation, InlineCitationSource } from "@/web/components/ai-elements/inline-citation";
import { hostOf, MALFORMED_NOTE } from "./format";

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

/** The distinct URLs a marker's numbers stand for, in marker order. */
const urlsForMarkers = (numbers: number[], sources: CitedSource[]): string[] => {
  const urls: string[] = [];
  for (const n of numbers) {
    const source = sources.find((s) => s.numbers.includes(n));
    if (source && !urls.includes(source.url)) urls.push(source.url);
  }
  return urls;
};

/** Text with its markers as inline citations. A marker that points at no URL stays as the text `[n]`. */
export function CitedSegments({ segments, sources }: { segments: MarkerSegment[]; sources: CitedSource[] }) {
  return segments.map((seg, i) => {
    if (typeof seg === "string") return <Fragment key={i}>{seg}</Fragment>;
    const urls = urlsForMarkers(seg.citation, sources);
    if (urls.length === 0) return <Fragment key={i}>[{seg.citation.join(",")}]</Fragment>;
    return <Citation key={i} urls={urls} />;
  });
}

/** Shown beside Exa text that was cut at leaked structure, and in place of a comparison with nothing readable left (D-042). */
export function MalformedNote() {
  return (
    <p className="text-sm text-muted-foreground" data-testid="malformed-note">
      {MALFORMED_NOTE}
    </p>
  );
}
