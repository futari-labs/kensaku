import { describe, expect, it } from "vitest";
import { imageBytesVerdict, imageUrlVerdict, sniffImage } from "../../src/core";

const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, ...body: number[][]) => {
  const payload = body.flat();
  return [...u32(8 + payload.length), ...ascii(type), ...payload];
};

describe("sniffImage", () => {
  it("reads a JPEG size from the first start-of-frame marker, skipping other segments", () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
    const dht = [0xff, 0xc4, 0x00, 0x02];
    const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0x58, 0x03, 0x20, 0x01, 0x01, 0x11, 0x00];
    expect(sniffImage(new Uint8Array([0xff, 0xd8, ...app0, ...dht, ...sof]))).toEqual({ type: "jpeg", width: 800, height: 600 });
  });

  it("reads a PNG size from IHDR", () => {
    const png = [0x89, ...ascii("PNG\r\n"), 0x1a, 0x0a, ...u32(13), ...ascii("IHDR"), ...u32(640), ...u32(480)];
    expect(sniffImage(new Uint8Array(png))).toEqual({ type: "png", width: 640, height: 480 });
  });

  it("reads a GIF size", () => {
    expect(sniffImage(new Uint8Array([...ascii("GIF89a"), 1, 0, 1, 0, 0, 0, 0]))).toEqual({ type: "gif", width: 1, height: 1 });
  });

  it("reads the three WebP flavors", () => {
    const riff = (chunk: string, body: number[]) => new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(chunk), 0, 0, 0, 0, ...body]);
    const vp8x = riff("VP8X", [0, 0, 0, 0, 0x1f, 0x03, 0x00, 0x57, 0x02, 0x00]);
    expect(sniffImage(vp8x)).toEqual({ type: "webp", width: 800, height: 600 });
    const bits = (799 | (599 << 14)) >>> 0;
    const vp8l = riff("VP8L", [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >> 24) & 255]);
    expect(sniffImage(vp8l)).toEqual({ type: "webp", width: 800, height: 600 });
    const vp8 = riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x20, 0x03, 0x58, 0x02]);
    expect(sniffImage(vp8)).toEqual({ type: "webp", width: 800, height: 600 });
  });

  it("reads an AVIF size from the ispe box nested in meta, iprp, ipco", () => {
    const ispe = box("ispe", [0, 0, 0, 0], u32(1536), u32(900));
    const avif = [...box("ftyp", ascii("avif"), u32(0), ascii("avifmif1")), ...box("meta", [0, 0, 0, 0], box("iprp", box("ipco", ispe)))];
    expect(sniffImage(new Uint8Array(avif))).toEqual({ type: "avif", width: 1536, height: 900 });
  });

  it("reports AVIF without an ispe box as type known, size unknown", () => {
    const avif = box("ftyp", ascii("avif"), u32(0), ascii("avif"));
    expect(sniffImage(new Uint8Array([...avif, ...box("free", [0])]))).toEqual({ type: "avif", width: 0, height: 0 });
  });

  it("does not take a HEIC file or random bytes for an image", () => {
    expect(sniffImage(new Uint8Array(box("ftyp", ascii("heic"), u32(0), ascii("mif1"))))).toEqual({ type: "unknown", width: 0, height: 0 });
    expect(sniffImage(new Uint8Array(ascii("<html></html>")))).toEqual({ type: "unknown", width: 0, height: 0 });
    expect(sniffImage(new Uint8Array())).toEqual({ type: "unknown", width: 0, height: 0 });
  });

  it("survives truncated input of every format", () => {
    for (const head of [[0xff, 0xd8, 0xff], [0x89, ...ascii("PNG")], ascii("RIFF"), ascii("GIF8"), [0, 0, 0, 0x20, ...ascii("ftypavif")]]) {
      expect(() => sniffImage(new Uint8Array(head))).not.toThrow();
    }
  });
});

describe("image verdict precedence", () => {
  it("reports the first failing url check", () => {
    expect(imageUrlVerdict("https://u:p@x.example/logo.svg")).toBe("credentials");
    expect(imageUrlVerdict("ftp://x.example/logo.svg")).toBe("bad-scheme");
    expect(imageUrlVerdict("https://x.example/logo.svg")).toBe("svg");
    expect(imageUrlVerdict(`https://x.example/${"a".repeat(2048)}.jpg`)).toBe("invalid-url");
    expect(imageUrlVerdict("https://x.example/logo%ZZ.jpg")).toBe("deny-pattern");
    expect(imageUrlVerdict("https://x.example/default/")).toBe("ok");
  });

  it("reports the first failing bytes check", () => {
    const tiny = { type: "gif", width: 1, height: 1 } as const;
    expect(imageBytesVerdict(tiny, 6 * 1024 * 1024)).toBe("too-large");
    expect(imageBytesVerdict(tiny, 43)).toBe("unsupported-type");
    expect(imageBytesVerdict({ type: "png", width: 0, height: 100 }, 43)).toBe("no-dimensions");
    expect(imageBytesVerdict({ type: "png", width: 199, height: 100 }, 43)).toBe("too-small");
    expect(imageBytesVerdict({ type: "png", width: 1000, height: 1000 }, 5 * 1024 * 1024)).toBe("ok");
    expect(imageBytesVerdict({ type: "png", width: 1800, height: 1000 }, 43)).toBe("ok");
    expect(imageBytesVerdict({ type: "png", width: 1801, height: 1000 }, 43)).toBe("aspect");
    expect(imageBytesVerdict({ type: "png", width: 200, height: 400 }, 43)).toBe("ok");
    expect(imageBytesVerdict({ type: "png", width: 200, height: 401 }, 43)).toBe("aspect");
  });
});
