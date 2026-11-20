import type { ResolvedCitations } from "./types";

const MARKER = /([ \t]*)\[(\d+(?:,\d+)*)\]/g;
// Capturing, so split() keeps each separator at an odd index and the original text can be rejoined unchanged.
const BLANK_LINE = /(\n(?:[ \t\r]*\n)+)/;

/** Paragraphs are runs of text between blank lines; whitespace-only blocks are not paragraphs. Indexes in `uncitedParagraphs` refer to this list. */
export function splitParagraphs(text: string): string[] {
  return text.split(BLANK_LINE).filter((part, i) => i % 2 === 0 && part.trim() !== "");
}

/** Resolves 1-based `[n]` and `[n,m]` markers against citation URLs; unresolvable numbers are removed and counted. */
export function resolveCitations(text: string, citationUrls: string[]): ResolvedCitations {
  const sources = new Set<string>();
  const uncitedParagraphs: number[] = [];
  let unresolvedMarkers = 0;
  let paragraph = 0;

  const renderedText = text
    .split(BLANK_LINE)
    .map((part, i) => {
      if (i % 2 === 1 || part.trim() === "") return part;
      let resolved = 0;
      const rendered = part.replace(MARKER, (_marker, lead: string, numbers: string) => {
        const kept: string[] = [];
        for (const raw of numbers.split(",")) {
          const n = Number(raw);
          const url = Number.isSafeInteger(n) && n >= 1 ? citationUrls[n - 1] : undefined;
          if (url === undefined) {
            unresolvedMarkers++;
            continue;
          }
          kept.push(raw);
          resolved++;
          sources.add(url);
        }
        return kept.length > 0 ? `${lead}[${kept.join(",")}]` : "";
      });
      if (resolved === 0) uncitedParagraphs.push(paragraph);
      paragraph++;
      return rendered;
    })
    .join("");

  return { renderedText, sources: [...sources], unresolvedMarkers, uncitedParagraphs };
}
