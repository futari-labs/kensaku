import { z } from "zod";
import type { Cart, Order } from "../../core/commerce";

// What the page reads of the commerce API (ARCHITECTURE, "HTTP API (v1.2)"). Parsed at the boundary; extra fields are kept out.
const CurrencySchema = z.enum(["USD", "SGD", "JPY"]);
const CartSchema = z.object({
  version: z.number(),
  currency: CurrencySchema.nullable(),
  lines: z.array(
    z.object({
      offerId: z.string(),
      productName: z.string(),
      merchantHost: z.string(),
      quantity: z.number(),
      demoUnitAmountMinor: z.number(),
      observed: z.object({ amount: z.number(), currency: CurrencySchema, retrievedAt: z.string(), merchantHost: z.string() }),
    }),
  ),
}) satisfies z.ZodType<Cart>;
const CartViewSchema = z.object({ cart: CartSchema, totalMinor: z.number(), checkoutConfigured: z.boolean() });
const OrderSchema = z.object({
  orderId: z.string(),
  state: z.enum(["open", "paid", "cancelled", "expired", "payment_failed", "failed"]),
  stripeSessionId: z.string().nullable(),
  declinedAttempts: z.number(),
  lines: z.array(z.object({ merchantHost: z.string() })),
}) satisfies z.ZodType<Pick<Order, "orderId" | "state" | "stripeSessionId" | "declinedAttempts"> & { lines: Pick<Order["lines"][number], "merchantHost">[] }>;
const ErrorSchema = z.object({ code: z.string(), details: z.object({ cartCurrency: CurrencySchema, offerCurrency: CurrencySchema }).optional() });

export type CartView = z.infer<typeof CartViewSchema>;
export type OrderView = z.infer<typeof OrderSchema>;

export type Reply<T> = { ok: true; value: T } | { ok: false; status: number; code: string; details?: { cartCurrency: string; offerCurrency: string } };

/** One request. A reply the page cannot read, or no reply at all, is `code: "unreadable"`. */
async function call<T>(method: string, path: string, parse: (body: unknown) => T | undefined, body?: unknown): Promise<Reply<T>> {
  try {
    const res = await fetch(path, { method, ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const json: unknown = await res.json().catch(() => undefined);
    if (res.ok) {
      const value = parse(json);
      return value === undefined ? { ok: false, status: res.status, code: "unreadable" } : { ok: true, value };
    }
    const error = ErrorSchema.safeParse(json);
    return error.success ? { ok: false, status: res.status, code: error.data.code, ...(error.data.details && { details: error.data.details }) } : { ok: false, status: res.status, code: "unreadable" };
  } catch {
    return { ok: false, status: 0, code: "unreadable" };
  }
}

const parseWith = <T>(schema: z.ZodType<T>) => (body: unknown): T | undefined => {
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
};

const cartReply = (body: unknown): Cart | undefined => parseWith(z.object({ cart: CartSchema }))(body)?.cart;

export const fetchCart = () => call("GET", "/api/cart", parseWith(CartViewSchema));
export const addToCart = (offerId: string, replace = false) => call("POST", "/api/cart/items", cartReply, { offerId, ...(replace && { replace }) });
export const setQuantity = (offerId: string, quantity: number) => call("PATCH", `/api/cart/items/${encodeURIComponent(offerId)}`, cartReply, { quantity });
export const removeLine = (offerId: string) => call("DELETE", `/api/cart/items/${encodeURIComponent(offerId)}`, cartReply);
export const startCheckout = () => call("POST", "/api/checkout", parseWith(z.object({ orderId: z.string(), url: z.string() })), {});
export const fetchOrder = (id: string) => call("GET", `/api/orders/${encodeURIComponent(id)}`, (body) => parseWith(z.object({ order: OrderSchema }))(body)?.order);
export const cancelOrder = (id: string) => call("POST", `/api/orders/${encodeURIComponent(id)}/cancel`, (body) => parseWith(z.object({ order: OrderSchema }))(body)?.order, {});

const STRIPE_CHECKOUT_PREFIX = "https://checkout.stripe.com/";

/** D-055: the one place the page leaves for another origin. The test fake's path is accepted only in a fixture build. */
export function isCheckoutUrl(url: string, fixture: boolean): boolean {
  return url.startsWith(STRIPE_CHECKOUT_PREFIX) || (fixture && url.startsWith(`${window.location.origin}/__test/checkout/`));
}

export interface CheckoutReturn {
  outcome: "success" | "cancelled";
  orderId: string;
  sessionId: string | undefined;
}

/** `?checkout=success|cancelled&order=…&session_id=…`, or undefined when the page was not opened by a checkout redirect. */
export function readCheckoutReturn(search: string): CheckoutReturn | undefined {
  const params = new URLSearchParams(search);
  const outcome = params.get("checkout");
  const orderId = params.get("order");
  if ((outcome !== "success" && outcome !== "cancelled") || !orderId) return undefined;
  return { outcome, orderId, sessionId: params.get("session_id") ?? undefined };
}
