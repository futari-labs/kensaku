import { z } from "zod";
import { CartSchema, CurrencySchema, OrderSchema } from "../../core/commerce";
import type { Cart, CurrencyMismatch, Order } from "../../core/commerce";

const CartViewSchema = z.object({ cart: CartSchema, totalMinor: z.number(), checkoutConfigured: z.boolean() });
const ErrorSchema = z.object({ code: z.string(), details: z.object({ cartCurrency: CurrencySchema, offerCurrency: CurrencySchema }).optional() });

export type CartView = z.infer<typeof CartViewSchema>;
export type OrderView = Order;

export type Reply<T> = { ok: true; value: T } | { ok: false; status: number; code: string; details?: CurrencyMismatch };

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
const orderReply = (body: unknown): Order | undefined => parseWith(z.object({ order: OrderSchema }))(body)?.order;

export const fetchCart = () => call("GET", "/api/cart", parseWith(CartViewSchema));
export const addToCart = (offerId: string, replace = false) => call("POST", "/api/cart/items", cartReply, { offerId, ...(replace && { replace }) });
export const setQuantity = (offerId: string, quantity: number) => call("PATCH", `/api/cart/items/${encodeURIComponent(offerId)}`, cartReply, { quantity });
export const removeLine = (offerId: string) => call("DELETE", `/api/cart/items/${encodeURIComponent(offerId)}`, cartReply);
export const startCheckout = () => call("POST", "/api/checkout", parseWith(z.object({ orderId: z.string(), url: z.string() })), {});
export const fetchOrder = (id: string) => call("GET", `/api/orders/${encodeURIComponent(id)}`, orderReply);
export const cancelOrder = (id: string) => call("POST", `/api/orders/${encodeURIComponent(id)}/cancel`, orderReply, {});

const STRIPE_CHECKOUT_PREFIX = "https://checkout.stripe.com/";

export function isCheckoutUrl(url: string, fixture: boolean): boolean {
  return url.startsWith(STRIPE_CHECKOUT_PREFIX) || (fixture && url.startsWith(`${window.location.origin}/__test/checkout/`));
}

const RETURN_PARAMS = ["checkout", "order", "session_id"] as const;

export interface CheckoutReturn {
  outcome: "success" | "cancelled";
  orderId: string;
  sessionId: string | undefined;
}

export function readCheckoutReturn(search: string): CheckoutReturn | undefined {
  const params = new URLSearchParams(search);
  const outcome = params.get("checkout");
  const orderId = params.get("order");
  if ((outcome !== "success" && outcome !== "cancelled") || !orderId) return undefined;
  return { outcome, orderId, sessionId: params.get("session_id") ?? undefined };
}

/** The address bar without the return parameters, so a reload does not repeat the cancel. */
export function withoutCheckoutReturn(search: string, pathname: string, hash: string): string {
  const rest = new URLSearchParams(search);
  for (const name of RETURN_PARAMS) rest.delete(name);
  return pathname + (rest.size > 0 ? `?${rest}` : "") + hash;
}
