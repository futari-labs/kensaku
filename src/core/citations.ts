import type { ResolvedCitations } from "./types";

const MARKER = /([ \t]*)\[(\d+(?:,\d+)*)\]/g;

/** Resolves 1-based `[n]` and `[n,m]` markers against citation URLs; unresolvable numbers are removed and counted. */
export function resolveCitations(text: string, citationUrls: string[]): ResolvedCitations {
  const sources: string[] = [];
  const seenSources = new Set<string>();
  let unresolvedMarkers = 0;
  const resolvedPerParagraph: number[] = [];
  let paragraph = 0;
  let lastEnd = 0;
  let rendered = "";

  // Paragraph boundaries are blank lines; walk the text once so markers map to their paragraph.
  const boundaries = [...text.matchAll(/\n[ \t\r]*\n/g)].map((m) => m.index + m[0].length);
  const paragraphAt = (position: number): number => {
    while (paragraph < boundaries.length && boundaries[paragraph]! <= position) paragraph++;
    return paragraph;
  };

  for (const match of text.matchAll(MARKER)) {
    const [whole, lead, numbers] = match as unknown as [string, string, string];
    const start = match.index;
    rendered += text.slice(lastEnd, start);
    lastEnd = start + whole.length;
    const index = paragraphAt(start + lead.length);
    resolvedPerParagraph[index] ??= 0;
    const kept: string[] = [];
    for (const raw of numbers.split(",")) {
      const n = Number(raw);
      const url = Number.isSafeInteger(n) && n >= 1 ? citationUrls[n - 1] : undefined;
      if (url === undefined) {
        unresolvedMarkers++;
        continue;
      }
      kept.push(raw);
      resolvedPerParagraph[index]++;
      if (!seenSources.has(url)) {
        seenSources.add(url);
        sources.push(url);
      }
    }
    if (kept.length > 0) rendered += `${lead}[${kept.join(",")}]`;
  }
  rendered += text.slice(lastEnd);

  const paragraphCount = boundaries.length + 1;
  const uncitedParagraphs: number[] = [];
  for (let i = 0; i < paragraphCount; i++) if (!resolvedPerParagraph[i]) uncitedParagraphs.push(i);
  return { renderedText: rendered, sources, unresolvedMarkers, uncitedParagraphs };
}
