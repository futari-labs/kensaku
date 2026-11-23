import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { CartErrorCode } from "../core/commerce";
import { parseCartOp, publicOrder } from "../core/commerce";
import type { OfferStore } from "../commerce/registry";
import type { CommerceService } from "../commerce/service";

export interface CommerceDeps {
  service: CommerceService;
  /** Where research registers the offers a cart may later hold. */
  offers: OfferStore;
  /** Verifies webhook deliveries. Absent: the webhook route answers 503. */
  webhookSecret: string | undefined;
  /** Fixture mode only: the fake Stripe page and the test-only switches. */
  fakeHosted?: Hono;
}

const CART_STATUS = {
  "invalid-request": 400,
  "quantity-out-of-range": 400,
  "offer-not-registered": 404,
  "currency-mismatch": 409,
  "out-of-stock": 422,
  "invalid-price": 422,
  "below-minimum": 422,
  "quantity-limit": 422,
  "line-limit": 422,
  "total-too-large": 422,
  "not-in-cart": 404,
} as const satisfies Record<CartErrorCode, ContentfulStatusCode>;

const CHECKOUT_STATUS = { "cart-empty": 400, "checkout-not-configured": 503, "checkout-failed": 502 } as const;
const CANCEL_STATUS = { "order-not-found": 404, "already-paid": 409, "already-completed": 409, "cancel-failed": 502 } as const;

export function commerceRoutes({ service, webhookSecret }: CommerceDeps): Hono {
  const app = new Hono();

  /** Every commerce route lists this before its handler: with an unreadable data file none of them may run. */
  const available: MiddlewareHandler = async (c, next) => {
    if (service.unavailableReason !== undefined) return c.json({ code: "commerce-unavailable" }, 503);
    await next();
  };

  const cartOp = async (c: Context, fixed: Record<string, unknown>, body: unknown = {}) => {
    const parsed = parseCartOp(body, fixed);
    if (!parsed.ok) return c.json({ code: parsed.code }, CART_STATUS[parsed.code]);
    const result = await service.applyCartOp(parsed.op);
    if (result.ok) return c.json({ cart: result.cart });
    return c.json({ code: result.code, ...("details" in result && { details: result.details }) }, CART_STATUS[result.code]);
  };
  const jsonBody = (c: Context): Promise<unknown> => c.req.json().catch(() => undefined);

  app.get("/api/cart", available, (c) => c.json(service.cart()));
  app.post("/api/cart/items", available, async (c) => cartOp(c, { kind: "add" }, await jsonBody(c)));
  app.patch("/api/cart/items/:offerId", available, async (c) => cartOp(c, { kind: "setQuantity", offerId: c.req.param("offerId") }, await jsonBody(c)));
  app.delete("/api/cart/items/:offerId", available, (c) => cartOp(c, { kind: "remove", offerId: c.req.param("offerId") }));
  app.delete("/api/cart", available, (c) => cartOp(c, { kind: "clear" }));

  app.post("/api/checkout", available, async (c) => {
    const body = await c.req.text();
    if (body.trim() !== "" && body.trim() !== "{}") return c.json({ code: "invalid-request" }, 400);
    const result = await service.checkout();
    if (result.ok) return c.json({ orderId: result.orderId, url: result.url });
    return c.json({ code: result.code }, CHECKOUT_STATUS[result.code]);
  });

  app.get("/api/orders", available, (c) => c.json({ orders: service.orders().map(publicOrder) }));
  app.get("/api/orders/:id", available, (c) => {
    const order = service.order(c.req.param("id"));
    return order ? c.json({ order: publicOrder(order) }) : c.json({ code: "order-not-found" }, 404);
  });
  app.post("/api/orders/:id/cancel", available, async (c) => {
    const result = await service.cancel(c.req.param("id"));
    if (result.ok) return c.json({ order: publicOrder(result.order) });
    return c.json({ code: result.code }, CANCEL_STATUS[result.code]);
  });

  app.post("/api/stripe/webhook", available, async (c) => {
    if (webhookSecret === undefined) return c.json({ code: "checkout-not-configured" }, 503);
    // The raw bytes, before any JSON parsing: the signature covers exactly these.
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    const reply = await service.deliver({ rawBody, signature: c.req.header("stripe-signature"), secret: webhookSecret });
    return c.json({ outcome: reply.outcome }, reply.status);
  });

  return app;
}
