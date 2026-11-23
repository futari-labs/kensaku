import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CommerceState } from "../core/commerce";

const CurrencySchema = z.enum(["USD", "SGD", "JPY"]);
const OrderStateSchema = z.enum(["open", "paid", "cancelled", "expired", "payment_failed", "failed"]);
const Count = z.number().int().nonnegative();

const CartLineSchema = z.object({
  offerId: z.string(),
  productName: z.string(),
  merchantHost: z.string(),
  quantity: Count,
  demoUnitAmountMinor: Count,
  observed: z.object({ amount: z.number(), currency: CurrencySchema, retrievedAt: z.string(), merchantHost: z.string() }),
});

const OrderSchema = z.object({
  orderId: z.string(),
  state: OrderStateSchema,
  reason: z.literal("superseded").optional(),
  anomaly: z.string().optional(),
  currency: CurrencySchema,
  lines: z.array(CartLineSchema),
  totalMinor: Count,
  cartVersion: Count,
  stripeSessionId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  declinedAttempts: Count,
  awaitingAsyncPayment: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  transitions: z.array(z.object({ at: z.string(), from: OrderStateSchema.nullable(), to: OrderStateSchema, eventId: z.string().optional() })),
});

const CommerceStateSchema = z.object({
  version: z.literal(1),
  cart: z.object({ version: Count, currency: CurrencySchema.nullable(), lines: z.array(CartLineSchema) }),
  orders: z.array(OrderSchema),
  processedEvents: z.array(z.object({ id: z.string(), at: z.string() })),
}) satisfies z.ZodType<CommerceState>;

export const emptyState = (): CommerceState => ({ version: 1, cart: { version: 0, currency: null, lines: [] }, orders: [], processedEvents: [] });

export type LoadedState = { ok: true; state: CommerceState } | { ok: false; reason: string };

/** The state lives in `<dir>/state.json`. */
export class CommerceStore {
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, "state.json");
  }

  /** A missing file is an empty state. A file that cannot be read, parsed, or validated is `ok: false` and is left untouched. */
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

  /** Temporary file plus rename, so a crash leaves the old file or the new one, never half of one. */
  save(state: CommerceState): void {
    mkdirSync(this.dir, { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temp, this.file);
  }
}
