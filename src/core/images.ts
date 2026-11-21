import { identityTextOf } from "./identity";
import type {
  Candidate,
  Evidence,
  ImageBytesVerdict,
  ImageSource,
  ImageUrlVerdict,
  Market,
  Offer,
  Rejected,
  SearchHit,
  SniffedImage,
} from "./types";

const MAX_URL_LENGTH = 2048;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_SIDE = 200;
const MIN_ASPECT = 0.5;
const MAX_ASPECT = 1.8;
const MAX_CANDIDATES = 4;
const MAX_TITLE_LENGTH = 120;

const DENY_TOKENS = [
  "logo", "social", "share", "placeholder", "missing", "noimage", "no-image", "no_image", "sprite", "banner",
  "campaign", "brandimage", "uedata", "pixel", "spacer", "favicon", "1x1",
];

/** Rule I1: whether an image URL may be fetched at all. The first failing check is reported. */
export function imageUrlVerdict(url: string): ImageUrlVerdict {
  if (url.length > MAX_URL_LENGTH) return "invalid-url";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "invalid-url";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "bad-scheme";
  if (parsed.username !== "" || parsed.password !== "") return "credentials";
  const written = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(written);
  } catch {
    decoded = written;
  }
  const fileName = decoded.toLowerCase();
  if (fileName.endsWith(".svg")) return "svg";
  return DENY_TOKENS.some((token) => fileName.includes(token)) ? "deny-pattern" : "ok";
}

const MARKET_CURRENCY = { US: "USD", SG: "SGD", JP: "JPY" } as const satisfies Record<Market, string>;

function isManufacturerHost(hostname: string, brand: string): boolean {
  const normalized = brand.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return normalized.length >= 3 && hostname.split(/[.-]/).includes(normalized);
}

type Classified = { hit: SearchHit; result: Offer | Evidence | Rejected };

function tierOf({ hit, result }: Classified, brand: string, market: Market): 1 | 2 | 3 | null {
  if (result.kind === "merchant-offer") {
    if (result.price.currency === MARKET_CURRENCY[market]) return 1;
    return isManufacturerHost(new URL(hit.url).hostname, brand) ? 2 : 3;
  }
  const ownPage = result.kind === "evidence" && (result.category === "not-a-listing" || result.category === "merchant-no-price");
  return ownPage && isManufacturerHost(new URL(hit.url).hostname, brand) ? 2 : null;
}

/** Rule I2: the product's image sources in tier order (market offers, manufacturer pages, other offers), at most 4. */
export function rankImageCandidates(classified: Classified[], candidate: Candidate, market: Market): ImageSource[] {
  const tiers: ImageSource[][] = [[], [], []];
  for (const entry of classified) {
    const { hit } = entry;
    if (typeof hit.image !== "string" || imageUrlVerdict(hit.image) !== "ok") continue;
    const tier = tierOf(entry, candidate.brand, market);
    if (tier === null) continue;
    tiers[tier - 1]!.push({ imageUrl: hit.image, pageUrl: hit.url, sourceTitle: identityTextOf(hit).slice(0, MAX_TITLE_LENGTH) });
  }
  const seen = new Set<string>();
  return tiers
    .flat()
    .filter((source) => !seen.has(source.imageUrl) && seen.add(source.imageUrl))
    .slice(0, MAX_CANDIDATES);
}

const UNKNOWN: SniffedImage = { type: "unknown", width: 0, height: 0 };
const startsWith = (bytes: Uint8Array, at: number, text: string) => [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));

function jpeg(bytes: Uint8Array): SniffedImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return { type: "jpeg", width: 0, height: 0 };
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at++;
      continue;
    }
    // Start of frame markers carry the size; 0xC4 (DHT), 0xC8 (JPG) and 0xCC (DAC) share the range but do not.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 9 > bytes.length) break;
      return { type: "jpeg", height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    }
    at += 2 + view.getUint16(at + 2);
  }
  return { type: "jpeg", width: 0, height: 0 };
}

function webp(bytes: Uint8Array): SniffedImage {
  const none: SniffedImage = { type: "webp", width: 0, height: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
  if (startsWith(bytes, 12, "VP8X") && bytes.length >= 30) return { type: "webp", width: u24(24) + 1, height: u24(27) + 1 };
  if (startsWith(bytes, 12, "VP8L") && bytes.length >= 25) {
    const bits = view.getUint32(21, true);
    return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (startsWith(bytes, 12, "VP8 ") && bytes.length >= 30) return { type: "webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  return none;
}

/** Finds the first `ispe` box inside meta > iprp > ipco. Box sizes of 0 (to end) and 1 (64-bit) are handled; malformed sizes stop the walk. */
function avif(bytes: Uint8Array): SniffedImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const containers: Record<string, number> = { meta: 4, iprp: 0, ipco: 0 };

  const find = (start: number, end: number): SniffedImage | null => {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return null;
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return null;
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      const body = at + header;
      if (type === "ispe" && body + 12 <= at + size) {
        return { type: "avif", width: view.getUint32(body + 4), height: view.getUint32(body + 8) };
      }
      const skip = containers[type];
      if (skip !== undefined) {
        const inner = find(body + skip, at + size);
        if (inner) return inner;
      }
      at += size;
    }
    return null;
  };

  return find(0, bytes.length) ?? { type: "avif", width: 0, height: 0 };
}

function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || !startsWith(bytes, 4, "ftyp")) return false;
  const end = Math.min(bytes.length, new DataView(bytes.buffer, bytes.byteOffset).getUint32(0));
  for (let at = 8; at + 4 <= end; at += 4) {
    if (at !== 12 && (startsWith(bytes, at, "avif") || startsWith(bytes, at, "avis"))) return true;
  }
  return false;
}

/** Identifies JPEG, PNG, WebP, GIF, or AVIF from magic bytes and reads the pixel size; unreadable sizes are 0. */
export function sniffImage(bytes: Uint8Array): SniffedImage {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpeg(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 8 && bytes[0] === 0x89 && startsWith(bytes, 1, "PNG")) {
    return bytes.length >= 24 ? { type: "png", width: view.getUint32(16), height: view.getUint32(20) } : { type: "png", width: 0, height: 0 };
  }
  if (bytes.length >= 12 && startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) return webp(bytes);
  if (bytes.length >= 6 && startsWith(bytes, 0, "GIF8")) {
    return bytes.length >= 10 ? { type: "gif", width: view.getUint16(6, true), height: view.getUint16(8, true) } : { type: "gif", width: 0, height: 0 };
  }
  if (isAvif(bytes)) return avif(bytes);
  return UNKNOWN;
}

/** Rule I3: whether fetched bytes may be served. The first failing check is reported. */
export function imageBytesVerdict(image: SniffedImage, byteLength: number): ImageBytesVerdict {
  if (byteLength > MAX_IMAGE_BYTES) return "too-large";
  if (image.type === "unknown" || image.type === "gif") return "unsupported-type";
  if (!(image.width > 0 && image.height > 0)) return "no-dimensions";
  if (Math.min(image.width, image.height) < MIN_SIDE) return "too-small";
  const aspect = image.width / image.height;
  return aspect < MIN_ASPECT || aspect > MAX_ASPECT ? "aspect" : "ok";
}
