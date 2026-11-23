import { imageBytesVerdict, sniffImage } from "../../core";
import type { SniffedImage } from "../../core";
import { MAX_IMAGE_BYTES } from "./network";
import type { FetchResult, ServedType, Verdict } from "./types";

const SERVED: ReadonlySet<SniffedImage["type"]> = new Set<ServedType>(["jpeg", "png", "webp", "avif"]);
const isServed = (type: SniffedImage["type"]): type is ServedType => SERVED.has(type);

/** `size` is the bytes read and inspected (0 when the fetch produced none); `accepted` is the bytes to store and serve, present exactly for an `ok` verdict. */
export type Classified = { size: number } & (
  | { verdict: Extract<Verdict, { status: "ok" }>; accepted: Uint8Array }
  | { verdict: Exclude<Verdict, { status: "ok" }>; accepted?: undefined }
);

/** Rule I3 applied to one fetch result. Pure: no clock, no disk. */
export function classify(result: FetchResult, fetchedAt: number): Classified {
  if (!result.ok) return { verdict: { status: "failed", reason: result.reason, fetchedAt }, size: 0 };
  const size = result.bytes.length;
  if (size > MAX_IMAGE_BYTES) return { verdict: { status: "failed", reason: "too-large", fetchedAt }, size: 0 };
  const sniffed = sniffImage(result.bytes);
  const rule = imageBytesVerdict(sniffed, size);
  if (rule === "too-large") return { verdict: { status: "failed", reason: "too-large", fetchedAt }, size };
  if (rule === "ok" && isServed(sniffed.type)) return { verdict: { status: "ok", type: sniffed.type, fetchedAt }, size, accepted: result.bytes };
  return { verdict: { status: "rejected", reason: rule === "ok" ? "unsupported-type" : rule, fetchedAt }, size };
}
