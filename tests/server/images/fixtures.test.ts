import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { imageBytesVerdict, sniffImage } from "../../../src/core";
import { FixtureImageFetch, isAllowedAddress } from "../../../src/server/images";
import { buildFixtures } from "../../fixtures/images/generate";
import { fixture } from "./helpers";

const expected = {
  "ok-400x300.jpg": ["jpeg", 400, 300, "ok"],
  "ok-400x300.png": ["png", 400, 300, "ok"],
  "ok-400x300.webp": ["webp", 400, 300, "ok"],
  "ok-400x300.avif": ["avif", 400, 300, "ok"],
  "fail-1x1.gif": ["gif", 1, 1, "unsupported-type"],
  "fail-doc.svg": ["unknown", 0, 0, "unsupported-type"],
  "fail-150x400.png": ["png", 150, 400, "too-small"],
  "fail-1200x630.webp": ["webp", 1200, 630, "aspect"],
} as const;

describe("fixture images", () => {
  it.each(Object.entries(expected))("%s has its documented type, size, and rule I3 verdict", (name, [type, width, height, verdict]) => {
    const bytes = fixture(name);
    expect(sniffImage(bytes)).toEqual({ type, width, height });
    expect(imageBytesVerdict(sniffImage(bytes), bytes.length)).toBe(verdict);
  });

  it("the generator reproduces the committed files byte for byte", () => {
    for (const [name, bytes] of Object.entries(buildFixtures())) expect(Buffer.from(bytes).equals(fixture(name)), name).toBe(true);
  });
});

describe("FixtureImageFetch", () => {
  const dir = join(import.meta.dirname, "../../fixtures/images");

  it("serves a mapped file from the directory it is given, and a 404 for anything else", async () => {
    const port = new FixtureImageFetch({ "https://cdn.example.com/a.jpg": "ok-400x300.jpg" }, dir);
    expect(await port.fetch("https://cdn.example.com/a.jpg")).toEqual({ ok: true, bytes: fixture("ok-400x300.jpg") });
    expect(await port.fetch("https://cdn.example.com/other.jpg")).toEqual({ ok: false, reason: "upstream-status" });
    expect(await port.fetch("constructor")).toEqual({ ok: false, reason: "upstream-status" });
  });

  it.each(["../fixtures.test.ts", "sub/ok-400x300.jpg", "/etc/passwd", "..", ""])("rejects the mapping value %j, which is not a bare file name", (file) => {
    expect(() => new FixtureImageFetch({ "https://cdn.example.com/a.jpg": file }, dir)).toThrow(/file name/);
  });
});

describe("isAllowedAddress", () => {
  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "223.255.255.255", "2606:4700::1111", "2a00:1450:4001::1", "3fff::1", "2600::1", "100.63.255.255", "100.128.0.0", "2000::1", "2001:4860:4860::8888", "2001:1::1", "2003::1", "9.255.255.255", "11.0.0.0", "172.15.255.255", "198.17.255.255", "198.20.0.0", "192.0.1.1", "192.0.3.1"])("allows %s", (address) => {
    expect(isAllowedAddress(address)).toBe(true);
  });

  it.each(["198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "192.0.0.1", "224.0.0.1", "255.255.255.255", "2001:0::1", "2001:db8:1::1", "2002::1", "4000::1", "1fff::1", "not-an-ip", "1.2.3", "100.64.0.0", "100.127.255.255", "240.0.0.1", "172.31.255.255", "::ffff:8.8.8.8", "::8.8.8.8", "fe80::1%eth0", "2606:4700::1111%1", "2001:0:1::1", "2002:808:808::1", "01.2.3.4", "8.8.8.8/8", ""])(
    "refuses %s",
    (address) => {
      expect(isAllowedAddress(address)).toBe(false);
    },
  );
});
