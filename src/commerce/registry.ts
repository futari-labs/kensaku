import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RegisteredOffer } from "../core/commerce";
import type { Market, Offer } from "../core/types";
import type { Clock } from "../exa/clock";

export const OFFER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[0-9a-f]{64}$/;

const RegisteredOfferSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  canonicalUrl: z.string(),
  merchantHost: z.string(),
  merchantName: z.string(),
  productName: z.string(),
  price: z.object({ amount: z.number(), currency: z.enum(["USD", "SGD", "JPY"]) }),
  availability: z.enum(["in_stock", "out_of_stock", "preorder", "unknown"]),
  exaRequestId: z.string(),
  retrievedAt: z.string(),
  market: z.enum(["US", "SG", "JP"]),
  registeredAt: z.string(),
}) satisfies z.ZodType<RegisteredOffer>;

const readSnapshot = (file: string): RegisteredOffer | undefined => {
  try {
    const parsed = RegisteredOfferSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export class OfferStore {
  constructor(private readonly options: { dir: string; clock: Clock }) {}

  register(offers: readonly Offer[], market: Market): void {
    const registeredAt = this.options.clock().toISOString();
    mkdirSync(this.options.dir, { recursive: true });
    for (const offer of offers) {
      if (offer.id === undefined || !ID_PATTERN.test(offer.id)) continue;
      const snapshot: RegisteredOffer = {
        id: offer.id,
        canonicalUrl: offer.canonicalUrl,
        merchantHost: offer.merchantHost,
        merchantName: offer.merchantName,
        productName: offer.productName,
        price: offer.price,
        availability: offer.availability,
        exaRequestId: offer.exaRequestId,
        retrievedAt: offer.retrievedAt,
        market,
        registeredAt,
      };
      const file = this.path(offer.id);
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(snapshot));
      renameSync(temp, file);
    }
    this.prune();
  }

  get = (id: string): RegisteredOffer | undefined => (ID_PATTERN.test(id) ? readSnapshot(this.path(id)) : undefined);

  prune(): void {
    const cutoff = this.options.clock().getTime() - OFFER_TTL_MS;
    let names: string[];
    try {
      names = readdirSync(this.options.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = join(this.options.dir, name);
      const snapshot = readSnapshot(file);
      if (snapshot && Date.parse(snapshot.registeredAt) < cutoff) rmSync(file, { force: true });
    }
  }

  private path(id: string): string {
    return join(this.options.dir, `${id}.json`);
  }
}
