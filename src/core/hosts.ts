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
];

/** An entry matches when the hostname equals the entry host or is a subdomain of it, and the path has the entry's prefix. */
export function matchesHostList(url: URL, list: readonly HostEntry[]): boolean {
  const hostname = url.hostname;
  return list.some(
    (entry) =>
      (hostname === entry.host || hostname.endsWith(`.${entry.host}`)) &&
      (entry.pathPrefix === undefined || url.pathname.startsWith(entry.pathPrefix)),
  );
}
