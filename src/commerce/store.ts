import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommerceStateSchema, emptyCart } from "../core/commerce";
import type { CommerceState } from "../core/commerce";
import { writeJsonAtomic } from "../exa/files";

export const emptyState = (): CommerceState => ({ version: 1, cart: emptyCart(0), orders: [], processedEvents: [] });

export type LoadedState = { ok: true; state: CommerceState } | { ok: false; reason: string };

export class CommerceStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = join(dir, "state.json");
  }

  load(): LoadedState {
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, state: emptyState() };
      return { ok: false, reason: "state file unreadable" };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: "state file is not valid JSON" };
    }
    const parsed = CommerceStateSchema.safeParse(json);
    return parsed.success ? { ok: true, state: parsed.data } : { ok: false, reason: "state file does not match the expected shape" };
  }

  save(state: CommerceState): void {
    writeJsonAtomic(this.file, state);
  }
}
