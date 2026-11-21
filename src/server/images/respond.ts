import type { ServedType, Verdict } from "./types";

const CONTENT_TYPES: Record<ServedType, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };

/** Every header an image-route response carries, whoever produced it. */
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

/** What a `GET /api/image/:id` ends in. */
export type Outcome =
  | (Extract<Verdict, { status: "ok" }> & { bytes: Uint8Array })
  | Omit<Exclude<Verdict, { status: "ok" }>, "fetchedAt">
  | { status: "cross-site" | "unknown-image" };

/** The one place a status code is chosen: 200, 403, 404, 422, or 502. */
export function toResponse(outcome: Outcome): Response {
  const error = (status: number, message: string) => Response.json({ error: message }, { status, headers: { ...SECURITY_HEADERS, "Cache-Control": "no-store" } });
  switch (outcome.status) {
    case "ok":
      return new Response(Buffer.from(outcome.bytes), {
        headers: { ...SECURITY_HEADERS, "Content-Type": CONTENT_TYPES[outcome.type], "Cache-Control": "private, max-age=604800" },
      });
    case "cross-site":
      return error(403, "cross-site");
    case "unknown-image":
      return error(404, "unknown-image");
    case "rejected":
      return error(422, outcome.reason);
    case "failed":
      return error(502, outcome.reason);
  }
}
