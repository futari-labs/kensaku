import { describe, expect, it } from "vitest";
import { imageBytesVerdict, sniffImage } from "../../../src/core";
import { isAllowedAddress } from "../../../src/server/images";
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

  it("the generator makes files of the same type and size as the committed ones", () => {
    for (const [name, bytes] of Object.entries(buildFixtures())) expect(sniffImage(bytes), name).toEqual(sniffImage(fixture(name)));
  });
});

describe("isAllowedAddress", () => {
  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "223.255.255.255", "2606:4700::1111", "2a00:1450:4001::1", "3fff::1"])("allows %s", (address) => {
    expect(isAllowedAddress(address)).toBe(true);
  });

  it.each(["198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "192.0.0.1", "224.0.0.1", "255.255.255.255", "2001:0::1", "2001:db8:1::1", "2002::1", "4000::1", "1fff::1", "not-an-ip", "1.2.3"])(
    "refuses %s",
    (address) => {
      expect(isAllowedAddress(address)).toBe(false);
    },
  );
});
