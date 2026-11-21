import { resolveCitations } from "./citations";
import type { ResolvedCitations } from "./types";

const MAX_KEY_SPECS = 5;
const MAX_SPEC_LENGTH = 80;

/** Trimmed non-empty strings of at most 80 characters, first occurrence of each, at most 5, in Exa's order. */
export function normalizeKeySpecs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const specs = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const spec = item.trim();
    if (spec !== "" && spec.length <= MAX_SPEC_LENGTH) specs.add(spec);
    if (specs.size === MAX_KEY_SPECS) break;
  }
  return [...specs];
}

/**
 * Exa sometimes appends leaked structured output to good text (D-042). Text with a brace is cut at the first one; the
 * result is null when no letter is left before it.
 */
export function cutLeakedStructure(text: string): { text: string; truncated: boolean } | null {
  const brace = text.search(/[{}]/);
  if (brace === -1) return { text, truncated: false };
  const kept = text.slice(0, brace).trimEnd();
  return /\p{L}/u.test(kept) ? { text: kept, truncated: true } : null;
}

/** The reason cut at leaked structure, then resolved against the comparison's citations; null when there is nothing to show. */
export function resolveReason(
  reason: unknown,
  citationUrls: string[],
): (ResolvedCitations & { truncated: boolean }) | null {
  if (typeof reason !== "string" || reason.trim() === "") return null;
  const cut = cutLeakedStructure(reason);
  if (cut === null) return null;
  return { ...resolveCitations(cut.text, citationUrls), truncated: cut.truncated };
}
