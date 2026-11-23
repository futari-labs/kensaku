import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { OFFER_ID_PATTERN, RegisteredOfferSchema, toRegisteredOffer } from "../core/commerce";
import type { RegisteredOffer } from "../core/commerce";
import type { Market, Offer } from "../core/types";
import type { Clock } from "../exa/clock";
import { writeJsonAtomic } from "../exa/files";

export const OFFER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    for (const offer of offers) {
      const snapshot = toRegisteredOffer(offer, market, registeredAt);
      if (snapshot && OFFER_ID_PATTERN.test(snapshot.id)) writeJsonAtomic(this.path(snapshot.id), snapshot);
    }
    this.prune();
  }

  get = (id: string): RegisteredOffer | undefined => (OFFER_ID_PATTERN.test(id) ? readSnapshot(this.path(id)) : undefined);

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
