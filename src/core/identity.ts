import type { Candidate } from "./types";

function tokenize(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "");
}

function usableIdentifiers(candidate: Candidate): string[] {
  const usable: string[] = [];
  for (const identifier of candidate.modelIdentifiers) {
    const tokens = tokenize(identifier);
    const joined = tokens.join("");
    if (joined.length >= 4 && (/\d/.test(joined) || tokens.length >= 2)) usable.push(joined);
  }
  return usable;
}

/** True when a usable model identifier equals the concatenation of a run of consecutive tokens in the text. */
export function matchesIdentity(identityText: string, candidate: Candidate): boolean {
  const identifiers = new Set(usableIdentifiers(candidate));
  if (identifiers.size === 0) return false;
  const tokens = tokenize(identityText);
  for (let start = 0; start < tokens.length; start++) {
    let run = "";
    for (let end = start; end < tokens.length; end++) {
      run += tokens[end];
      if (identifiers.has(run)) return true;
    }
  }
  return false;
}
