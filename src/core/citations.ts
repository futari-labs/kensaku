import type { ResolvedCitations } from "./types";

// The marker grammar is frozen in evals/cases/citations.json (CR-001): spaces or tabs, never a newline, may
// surround the numbers and commas. A marker may follow spaces or tabs, which are removed with it when it has no kept number.
const MARKER = /([ \t]*)\[[ \t]*(\d+(?:[ \t]*,[ \t]*\d+)*)[ \t]*\]/g;
// The canonical rendering of a kept marker: no spaces, no leading zeros. `segmentMarkers` reads only this form.
const CANONICAL_MARKER = /\[(\d+(?:,\d+)*)\]/;
// Capturing, so split() keeps each separator at an odd index and the original text can be rejoined unchanged.
const BLANK_LINE = /(\n(?:[ \t\r]*\n)+)/;

/** Paragraphs are runs of text between blank lines; whitespace-only blocks are not paragraphs. Indexes in `uncitedParagraphs` refer to this list. */
export function splitParagraphs(text: string): string[] {
  return text.split(BLANK_LINE).filter((part, i) => i % 2 === 0 && part.trim() !== "");
}

interface MarkerResolution {
  /** The marker's numbers that point at a citation. */
  kept: number[];
  urls: string[];
  dropped: number;
}

function resolveMarker(numbers: string, citationUrls: string[]): MarkerResolution {
  const out: MarkerResolution = { kept: [], urls: [], dropped: 0 };
  for (const raw of numbers.split(",")) {
    const n = Number(raw.trim());
    const url = Number.isSafeInteger(n) && n >= 1 ? citationUrls[n - 1] : undefined;
    if (url === undefined) {
      out.dropped++;
      continue;
    }
    out.kept.push(n);
    out.urls.push(url);
  }
  return out;
}

/** A cited URL with the citation numbers that point at it in the rendered text, ascending. */
export interface CitedSource {
  url: string;
  numbers: number[];
}

export interface CitedText extends ResolvedCitations {
  /** One entry per URL in `sources`, in the same order. */
  citedSources: CitedSource[];
}

/**
 * Resolves 1-based `[n]` and `[n, m]` markers (spaces and tabs allowed inside) against citation URLs; unresolvable numbers are removed
 * and counted. Each marker is resolved once, and `citedSources` says which numbers reached each URL.
 */
export function resolveCitations(text: string, citationUrls: string[]): CitedText {
  const numbersByUrl = new Map<string, Set<number>>();
  const uncitedParagraphs: number[] = [];
  let unresolvedMarkers = 0;
  let paragraph = 0;

  // The separators are kept at odd indexes, so rejoining the parts restores the text outside markers.
  const rendered = text.split(BLANK_LINE).map((part, i) => {
    if (i % 2 === 1) return part;
    let resolved = 0;
    const out = part.replace(MARKER, (_marker, lead: string, numbers: string) => {
      const r = resolveMarker(numbers, citationUrls);
      resolved += r.kept.length;
      unresolvedMarkers += r.dropped;
      r.kept.forEach((n, k) => {
        const url = r.urls[k]!;
        const seen = numbersByUrl.get(url) ?? new Set<number>();
        seen.add(n);
        numbersByUrl.set(url, seen);
      });
      return r.kept.length > 0 ? `${lead}[${r.kept.join(",")}]` : "";
    });
    if (part.trim() !== "") {
      if (resolved === 0) uncitedParagraphs.push(paragraph);
      paragraph++;
    }
    return out;
  });

  const citedSources = [...numbersByUrl].map(([url, numbers]) => ({ url, numbers: [...numbers].sort((a, b) => a - b) }));
  return {
    renderedText: rendered.join(""),
    sources: citedSources.map((s) => s.url),
    unresolvedMarkers,
    uncitedParagraphs,
    citedSources,
  };
}

/** A run of plain text, or the citation numbers of one `[n,m]` marker, in reading order. */
export type MarkerSegment = string | { citation: number[] };

/** Splits already-resolved text at its markers, using the same grammar as `resolveCitations`. */
export function segmentMarkers(text: string): MarkerSegment[] {
  const parts = text.split(CANONICAL_MARKER);
  return parts.map((part, i) => (i % 2 === 0 ? part : { citation: part.split(",").map(Number) })).filter((seg) => seg !== "");
}
