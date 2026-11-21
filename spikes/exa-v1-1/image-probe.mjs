#!/usr/bin/env node
// Image probe for plan kensaku-v1-1 (no Exa requests). For every `image` URL in the spike's
// live search fixtures and the MVP live fixtures, applies the proposed URL filter, fetches the
// bytes the way the planned server proxy would (no cookies, 8 s timeout, 5 MB cap, at most 3
// redirects), sniffs the real type from magic bytes, and reads pixel dimensions.
// Writes a TSV summary to stdout. Image bytes go only to the directory given by --save-dir
// (default: none); they are never committed.
// Usage: node spikes/exa-v1-1/image-probe.mjs [--save-dir DIR]

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const saveIdx = process.argv.indexOf("--save-dir");
const saveDir = saveIdx > 0 ? resolve(process.argv[saveIdx + 1]) : null;
if (saveDir) mkdirSync(saveDir, { recursive: true });

// Proposed deny patterns, matched against the lowercased last path segment (file name) only:
// run 1 showed CDN paths such as Courts' ".../default/..." holding real product photos.
// Each token came from a real junk image (logo, social card, placeholder, campaign banner, beacon).
const DENY = /(?:logo|social|share|placeholder|missing|no[-_]?image|sprite|banner|campaign|brandimage|uedata|pixel|spacer|favicon|1x1)/;
const MIN_SIDE = 200;
const MIN_ASPECT = 0.5;
// As first run on 2026-11-21. The frozen rule I3 later tightened this to 1.8 (research note V-F14);
// see evals/cases/image-selection.json `rules`, which is authoritative.
const MAX_ASPECT = 2.0;

function urlVerdict(raw) {
  let u;
  try { u = new URL(raw); } catch { return "invalid-url"; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "bad-scheme";
  if (u.username || u.password) return "credentials";
  if (/\.svg$/i.test(u.pathname)) return "svg";
  const file = decodeURIComponent(u.pathname.split("/").pop() ?? "").toLowerCase();
  if (DENY.test(file)) return "deny-pattern";
  return "ok";
}

function bytesVerdict(sn) {
  if (!["jpeg", "png", "webp", "avif"].includes(sn.type)) return `type-${sn.type}`;
  if (!sn.w || !sn.h) return "no-dimensions";
  if (Math.min(sn.w, sn.h) < MIN_SIDE) return "too-small";
  const aspect = sn.w / sn.h;
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return "aspect";
  return "ok";
}

function sniff(buf) {
  const b = buf;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { type: "png", w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { type: "jpeg", h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { type: "jpeg", w: 0, h: 0 };
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { type: "webp", w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { type: "webp", w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") { const bits = b.readUInt32LE(21); return { type: "webp", w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }; }
    return { type: "webp", w: 0, h: 0 };
  }
  if (b.length >= 10 && b.toString("ascii", 0, 3) === "GIF") return { type: "gif", w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length >= 12 && b.toString("ascii", 4, 12).startsWith("ftypavi")) {
    // Image spatial extents box: "ispe", 4 bytes version/flags, 4 bytes width, 4 bytes height.
    const at = b.indexOf("ispe", 0, "ascii");
    if (at > 0 && at + 16 <= b.length) return { type: "avif", w: b.readUInt32BE(at + 8), h: b.readUInt32BE(at + 12) };
    return { type: "avif", w: 0, h: 0 };
  }
  return { type: "unknown", w: 0, h: 0 };
}

async function fetchImage(raw) {
  let url = raw;
  for (let hop = 0; hop <= 3; hop += 1) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5", "user-agent": "Mozilla/5.0 (compatible; image-probe)" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url).href; continue; }
    const reader = res.body?.getReader();
    const chunks = []; let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) { await reader.cancel(); return { status: res.status, hops: hop, ctype: res.headers.get("content-type"), size, tooBig: true }; }
      chunks.push(value);
    }
    return { status: res.status, hops: hop, ctype: res.headers.get("content-type"), size, buf: Buffer.concat(chunks) };
  }
  return { status: 0, hops: 4, error: "too many redirects" };
}

const sources = [
  ...readdirSync(join(here, "out")).filter((f) => f.includes("search")).map((f) => join(here, "out", f)),
  ...["S1-headphones", "S2-mouse", "S3-espresso", "S4-ereader", "S6-fresh-crawl", "S8-market-sg", "S9-market-jp"].map((id) => join(root, "evals/fixtures/exa-live", `${id}.json`)),
];
const seen = new Set();
console.log(["fixture", "pageHost", "listing", "urlVerdict", "status", "type", "w", "h", "bytes", "bytesVerdict", "file", "imageUrl"].join("\t"));
for (const file of sources) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  for (const r of j.response.results ?? []) {
    if (!r.image || seen.has(r.image)) continue;
    seen.add(r.image);
    let s = {}; try { s = typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary ?? {}; } catch { /* ignore */ }
    const verdict = urlVerdict(r.image);
    let row = { status: "-", type: "-", w: "-", h: "-", size: "-", bv: "-", name: "-" };
    if (verdict !== "invalid-url" && verdict !== "bad-scheme") {
      try {
        const f = await fetchImage(r.image);
        const sn = f.buf ? sniff(f.buf) : { type: f.tooBig ? "too-big" : "-", w: 0, h: 0 };
        let name = "-";
        if (saveDir && f.buf && sn.type !== "unknown") {
          name = createHash("sha256").update(r.image).digest("hex").slice(0, 12) + "." + sn.type;
          writeFileSync(join(saveDir, name), f.buf);
        }
        const bv = f.status === 200 ? bytesVerdict(sn) : `http-${f.status}`;
        row = { status: f.status, type: sn.type, w: sn.w, h: sn.h, size: f.size ?? "-", bv, name };
      } catch (e) { row.status = `ERR:${e.name}`; }
    }
    console.log([j.id, new URL(r.url).host, String(s.isProductListing), verdict, row.status, row.type, row.w, row.h, row.size, row.bv, row.name, r.image].join("\t"));
  }
}
