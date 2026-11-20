import type { ResolvedCitations } from "./types";

const MARKER = /([ \t]*)\[(\d+(?:,\d+)*)\]/g;
// Capturing, so split() keeps each separator at an odd index and the original text can be rejoined unchanged.
const BLANK_LINE = /(\n(?:[ \t\r]*\n)+)/;

/** Paragraphs are runs of text between blank lines; whitespace-only blocks are not paragraphs. Indexes in `uncitedParagraphs` refer to this list. */
export function splitParagraphs(text: string): string[] {
  return text.split(BLANK_LINE).filter((part, i) => i % 2 === 0 && part.trim() !== "");
}

interface MarkerResolution {
  /** The marker's numbers that point at a citation, as written. */
  kept: string[];
  urls: string[];
  dropped: number;
}

function resolveMarker(numbers: string, citationUrls: string[]): MarkerResolution {
  const out: MarkerResolution = { kept: [], urls: [], dropped: 0 };
  for (const raw of numbers.split(",")) {
    const n = Number(raw);
    const url = Number.isSafeInteger(n) && n >= 1 ? citationUrls[n - 1] : undefined;
    if (url === undefined) {
      out.dropped++;
      continue;
    }
    out.kept.push(raw);
    out.urls.push(url);
  }
  return out;
}

/** Resolves 1-based `[n]` and `[n,m]` markers against citation URLs; unresolvable numbers are removed and counted. */
export function resolveCitations(text: string, citationUrls: string[]): ResolvedCitations {
  const sources = new Set<string>();
  const uncitedParagraphs: number[] = [];
  let unresolvedMarkers = 0;

  splitParagraphs(text).forEach((paragraph, index) => {
    let resolved = 0;
    for (const marker of paragraph.matchAll(MARKER)) {
      const r = resolveMarker(marker[2]!, citationUrls);
      resolved += r.kept.length;
      unresolvedMarkers += r.dropped;
      for (const url of r.urls) sources.add(url);
    }
    if (resolved === 0) uncitedParagraphs.push(index);
  });

  const renderedText = text.replace(MARKER, (_marker, lead: string, numbers: string) => {
    const { kept } = resolveMarker(numbers, citationUrls);
    return kept.length > 0 ? `${lead}[${kept.join(",")}]` : "";
  });

  return { renderedText, sources: [...sources], unresolvedMarkers, uncitedParagraphs };
}
