// Deterministic generator for the synthetic fixture images in this directory.
// Run: pnpm exec tsx tests/fixtures/images/generate.ts
import { crc32, deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => u32(n).reverse();
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const concat = (...parts: number[][]) => new Uint8Array(parts.flat());

/** Solid mid-grey baseline JPEG: every 8x8 block is a zero DC difference and an end-of-block. */
export function jpeg(width: number, height: number): Uint8Array {
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  const scan = new Array<number>(Math.ceil((blocks * 2) / 8)).fill(0);
  const table = (cls: number) => [0xff, 0xc4, ...u16(2 + 1 + 16 + 1), cls << 4, 1, ...new Array<number>(15).fill(0), 0];
  return concat(
    [0xff, 0xd8],
    [0xff, 0xdb, ...u16(67), 0, ...new Array<number>(64).fill(1)],
    [0xff, 0xc0, ...u16(11), 8, ...u16(height), ...u16(width), 1, 1, 0x11, 0],
    table(0),
    table(1),
    [0xff, 0xda, ...u16(8), 1, 1, 0x00, 0, 63, 0],
    scan,
    [0xff, 0xd9],
  );
}

const pngChunk = (type: string, body: number[]) => [...u32(body.length), ...ascii(type), ...body, ...u32(crc32(Uint8Array.from([...ascii(type), ...body])))];

/** Solid-colour 8-bit RGB PNG. */
export function png(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const row = [0, ...Array.from({ length: width }, () => rgb).flat()];
  const raw = Uint8Array.from(Array.from({ length: height }, () => row).flat());
  return concat(
    [0x89, ...ascii("PNG\r\n"), 0x1a, 0x0a],
    pngChunk("IHDR", [...u32(width), ...u32(height), 8, 2, 0, 0, 0]),
    pngChunk("IDAT", [...deflateSync(raw, { level: 9 })]),
    pngChunk("IEND", []),
  );
}

/** Solid-colour lossless WebP. Every prefix code has one symbol, so the pixel data takes zero bits. */
export function webp(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const bits: number[] = [];
  const put = (value: number, count: number) => {
    for (let i = 0; i < count; i++) bits.push((value >> i) & 1);
  };
  put(width - 1, 14);
  put(height - 1, 14);
  put(0, 1); // alpha not used
  put(0, 3); // version
  put(0, 3); // no transform, no colour cache, no meta prefix
  for (const symbol of [g, r, b, 255, 0]) {
    put(1, 1); // simple code
    put(0, 1); // one symbol
    put(1, 1); // symbol takes 8 bits
    put(symbol, 8);
  }
  const packed = Array.from({ length: Math.ceil(bits.length / 8) }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((byte, bit, k) => byte | (bit << k), 0),
  );
  const chunk = [0x2f, ...packed];
  const padded = chunk.length % 2 ? [...chunk, 0] : chunk;
  const body = [...ascii("WEBP"), ...ascii("VP8L"), ...u32le(chunk.length), ...padded];
  return concat(ascii("RIFF"), u32le(body.length), body);
}

const box = (type: string, ...body: number[][]) => {
  const payload = body.flat();
  return [...u32(8 + payload.length), ...ascii(type), ...payload];
};

/** An AVIF container (ftyp, meta, iprp, ipco, ispe) with no coded image. Enough to sniff; browsers cannot decode it. */
export function avifContainer(width: number, height: number): Uint8Array {
  const ispe = box("ispe", [0, 0, 0, 0], u32(width), u32(height));
  return concat(box("ftyp", ascii("avif"), u32(0), ascii("avifmif1")), box("meta", [0, 0, 0, 0], box("iprp", box("ipco", ispe))));
}

const gif1x1 = concat(ascii("GIF89a"), [
  1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, 0x21, 0xf9, 4, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b,
]);
const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#3366cc"/></svg>\n',
);

/** File name to bytes. `ok-*` pass rule I3; `fail-*` are rejected by it. */
export function buildFixtures(): Record<string, Uint8Array> {
  return {
    "ok-400x300.jpg": jpeg(400, 300),
    "ok-400x300.png": png(400, 300, [0x33, 0x66, 0xcc]),
    "ok-400x300.webp": webp(400, 300, [0x33, 0x99, 0x66]),
    "ok-400x300.avif": avifContainer(400, 300),
    "fail-1x1.gif": gif1x1,
    "fail-doc.svg": svg,
    "fail-150x400.png": png(150, 400, [0xcc, 0x66, 0x33]),
    "fail-1200x630.webp": webp(1200, 630, [0x99, 0x33, 0x66]),
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  for (const [name, bytes] of Object.entries(buildFixtures())) writeFileSync(join(import.meta.dirname, name), bytes);
}
