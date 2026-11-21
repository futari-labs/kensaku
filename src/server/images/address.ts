import { isIP } from "node:net";

/** IPv4 ranges that are not public unicast, as [network, prefix length]. */
const BLOCKED_V4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 3],
];

function parseV4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

function parseGroups(side: string): number[] | null {
  if (side === "") return [];
  const parts = side.split(":");
  const out: number[] = [];
  for (const [i, part] of parts.entries()) {
    if (part.includes(".")) {
      const v4 = parseV4(part);
      if (v4 === null || i !== parts.length - 1) return null;
      out.push(v4 >>> 16, v4 & 0xffff);
    } else if (/^[0-9a-f]{1,4}$/i.test(part)) out.push(parseInt(part, 16));
    else return null;
  }
  return out;
}

function parseV6(text: string): number[] | null {
  const halves = text.split("%")[0]!.split("::");
  if (halves.length > 2) return null;
  const head = parseGroups(halves[0]!);
  const tail = halves.length === 2 ? parseGroups(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * Whether the server may connect to this address (ARCHITECTURE, "Image proxy"). IPv4 must be public
 * unicast. IPv6 must be inside 2000::/3 and outside Teredo (2001::/32), documentation (2001:db8::/32),
 * and 6to4 (2002::/16). Anything that does not parse is refused.
 */
export function isAllowedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const n = parseV4(address);
    return n !== null && !BLOCKED_V4.some(([net, bits]) => n >>> (32 - bits) === net >>> (32 - bits));
  }
  if (family === 6) {
    const g = parseV6(address);
    if (!g) return false;
    const [g0, g1] = [g[0]!, g[1]!];
    if ((g0 & 0xe000) !== 0x2000) return false;
    if (g0 === 0x2001 && (g1 === 0 || g1 === 0x0db8)) return false;
    return g0 !== 0x2002;
  }
  return false;
}
