export interface HostEntry {
  host: string;
  pathPrefix?: string;
}

export const AGGREGATOR_HOSTS: readonly HostEntry[] = [
  { host: "kakaku.com" },
  { host: "product.rakuten.co.jp" },
  { host: "bestpricescanner.com" },
  { host: "deal.ai" },
  { host: "idealo.com" },
  { host: "idealo.de" },
  { host: "idealo.co.uk" },
  { host: "pricespy.co.uk" },
  { host: "pricespy.co.nz" },
  { host: "google.com", pathPrefix: "/shopping" },
  { host: "camelcamelcamel.com" },
  { host: "shopsavvy.com" },
  { host: "kiasuprice.com" },
  { host: "priceme.com" },
];

export const EDITORIAL_HOSTS: readonly HostEntry[] = [
  { host: "theverge.com" },
  { host: "howtogeek.com" },
  { host: "rtings.com" },
  { host: "soundguys.com" },
  { host: "techradar.com" },
  { host: "whathifi.com" },
  { host: "nytimes.com", pathPrefix: "/wirecutter" },
  { host: "cnet.com" },
  { host: "engadget.com" },
  { host: "tomsguide.com" },
  { host: "pcmag.com" },
  { host: "aboutamazon.com" },
  { host: "aboutamazon.jp" },
  { host: "androidcentral.com" },
  { host: "note.com" },
  { host: "hardwarezone.com.sg" },
];

export const MARKETPLACE_HOSTS: readonly HostEntry[] = [
  { host: "carousell.sg" },
  { host: "carousell.com" },
  { host: "jp.mercari.com" },
  { host: "auctions.yahoo.co.jp" },
];

const SEARCH_SEGMENTS = new Set(["search", "s", "category", "categories", "bestsellers", "productlist"]);
const EDITORIAL_SEGMENTS = new Set(["news", "blog", "blogs", "review", "reviews", "article", "articles"]);

/** The URL path split on "/", empty segments dropped, each percent-decoded (as written if decoding fails) and lowercased. */
export function pathSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    });
}

/** Rule 5b: a search host label, a search or category path segment, or a collection page that never reaches a product. */
export function isSearchOrCategoryPage(url: URL): boolean {
  if (url.hostname.split(".")[0] === "search") return true;
  const segments = pathSegments(url);
  if (segments.some((segment) => SEARCH_SEGMENTS.has(segment))) return true;
  const collections = segments.indexOf("collections");
  return collections !== -1 && !segments.slice(collections + 1).includes("products");
}

/** Rule 5c: a news, blog, review, or article path segment. */
export function isEditorialPath(url: URL): boolean {
  return pathSegments(url).some((segment) => EDITORIAL_SEGMENTS.has(segment));
}

/** An entry matches when the hostname equals the entry host or is a subdomain of it, and the path has the entry's prefix. */
export function matchesHostList(url: URL, list: readonly HostEntry[]): boolean {
  const hostname = url.hostname;
  return list.some(
    (entry) =>
      (hostname === entry.host || hostname.endsWith(`.${entry.host}`)) &&
      (entry.pathPrefix === undefined || url.pathname.startsWith(entry.pathPrefix)),
  );
}
