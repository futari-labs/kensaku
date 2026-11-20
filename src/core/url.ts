const DROPPED_PARAMS = new Set(["tag", "linkcode", "linkid", "ref", "ref_", "psc", "gclid", "fbclid"]);

function isDropped(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || DROPPED_PARAMS.has(lower);
}

/** Removes tracking and affiliate parameters, keeping every other parameter in its original order and encoding. */
export function canonicalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.search === "") return parsed.href;
  const kept = parsed.search
    .slice(1)
    .split("&")
    .filter((pair) => pair !== "" && !isDropped(pair.split("=", 1)[0] ?? ""));
  parsed.search = kept.length > 0 ? `?${kept.join("&")}` : "";
  return parsed.href;
}

/** The URL hostname, lowercased, with one leading "www." removed. */
export function merchantHostOf(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}
