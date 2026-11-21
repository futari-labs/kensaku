import { BlockList, isIP } from "node:net";

/** IPv4 ranges that are not public unicast (ARCHITECTURE, "Image proxy"), as [network, prefix length]. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3], // multicast, reserved, and 255.255.255.255
];

/** IPv6 only inside this block is global unicast; everything else, including IPv4-mapped forms, is outside it. */
const ALLOWED_V6: ReadonlyArray<readonly [string, number]> = [["2000::", 3]];

/** Inside the allowed block but still refused: Teredo, documentation, and 6to4. */
const BLOCKED_V6: ReadonlyArray<readonly [string, number]> = [
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
];

function listOf(rules: ReadonlyArray<readonly [string, number]>, family: "ipv4" | "ipv6"): BlockList {
  const list = new BlockList();
  for (const [network, prefix] of rules) list.addSubnet(network, prefix, family);
  return list;
}

const blockedV4 = listOf(BLOCKED_V4, "ipv4");
const allowedV6 = listOf(ALLOWED_V6, "ipv6");
const blockedV6 = listOf(BLOCKED_V6, "ipv6");

/** Whether the server may connect to this address. Anything that is not a plain IP literal is refused. */
export function isAllowedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return !address.includes("%") && allowedV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
  return false;
}
