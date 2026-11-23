import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { CartErrorCode, CartOp } from "../core/commerce";
import { parseCartOp } from "../core/commerce";
import type { CommerceService } from "../commerce/service";

export interface CommerceDeps {
  service: CommerceService;
  /** Verifies webhook deliveries. Absent: the webhook route answers 503. */
  webhookSecret: string | undefined;
  /** Test-only routes (`/__test/...`), present only in fixture mode under `NODE_ENV=test`. */
  fakeHosted?: Hono;
}

/** ARCHITECTURE, "HTTP API (v1.2)": the status of each EV-018 code. */
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The JSON body of a request, or undefined when it is missing or not an object. */
async function bodyOf(c: Context): Promise<Record<string, unknown> | undefined> {
  const body: unknown = await c.req.json().catch(() => undefined);
  return isRecord(body) ? body : undefined;
}

/** Commerce routes: every one is JSON, and every one answers 503 `commerce-unavailable` when the state file was unreadable. */
export function commerceRoutes({ service, webhookSecret }: CommerceDeps): Hono {
  const app = new Hono();

  // Not `"*"`: this app is mounted on the root, and research must keep working when commerce is unavailable.
  for (const path of ["/api/cart", "/api/cart/*", "/api/checkout", "/api/orders", "/api/orders/*", "/api/stripe/*"]) {
    app.use(path, async (c, next) => {
      if (service.unavailableReason !== undefined) return c.json({ code: "commerce-unavailable" }, 503);
      await next();
    });
  }

  /** Runs the op that `parseCartOp` accepted, or answers its parse failure. */
  const cartOp = async (c: Context, raw: unknown) => {
    const parsed = parseCartOp(raw);
    if (!parsed.ok) return c.json({ code: parsed.code }, CART_STATUS[parsed.code]);
    return respondToCartOp(c, parsed.op);
  };
  const respondToCartOp = async (c: Context, op: CartOp) => {
    const result = await service.applyCartOp(op);
    if (result.ok) return c.json({ cart: result.cart });
    return c.json({ code: result.code, ...("details" in result && { details: result.details }) }, CART_STATUS[result.code]);
  };

  app.get("/api/cart", (c) => c.json(service.cart()));

  app.post("/api/cart/items", async (c) => {
    const body = await bodyOf(c);
    // `kind` is the route's to choose; a body that names one is not the documented request.
    if (body === undefined || Object.hasOwn(body, "kind")) return c.json({ code: "invalid-request" }, 400);
    return cartOp(c, { ...body, kind: "add" });
  });

  app.patch("/api/cart/items/:offerId", async (c) => {
    const body = await bodyOf(c);
    if (body === undefined || Object.hasOwn(body, "kind") || Object.hasOwn(body, "offerId")) return c.json({ code: "invalid-request" }, 400);
    return cartOp(c, { ...body, kind: "setQuantity", offerId: c.req.param("offerId") });
  });

  app.delete("/api/cart/items/:offerId", (c) => cartOp(c, { kind: "remove", offerId: c.req.param("offerId") }));
  app.delete("/api/cart", (c) => cartOp(c, { kind: "clear" }));

  app.post("/api/checkout", async (c) => {
    const body = await c.req.text();
    if (body.trim() !== "" && body.trim() !== "{}") return c.json({ code: "invalid-request" }, 400);
    const result = await service.checkout();
    if (result.ok) return c.json({ orderId: result.orderId, url: result.url });
    return c.json({ code: result.code }, CHECKOUT_STATUS[result.code]);
  });

  app.get("/api/orders", (c) => c.json({ orders: service.orders() }));
  app.get("/api/orders/:id", (c) => {
    const order = service.order(c.req.param("id"));
    return order ? c.json({ order }) : c.json({ code: "order-not-found" }, 404);
  });

  app.post("/api/orders/:id/cancel", async (c) => {
    const result = await service.cancel(c.req.param("id"));
    if (result.ok) return c.json({ order: result.order });
    return c.json({ code: result.code }, CANCEL_STATUS[result.code]);
  });

  app.post("/api/stripe/webhook", async (c) => {
    if (webhookSecret === undefined) return c.json({ code: "checkout-not-configured" }, 503);
    // The raw bytes, before any JSON parsing: the signature covers exactly these.
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    const reply = await service.deliver({ rawBody, signature: c.req.header("stripe-signature"), secret: webhookSecret });
    return c.json({ outcome: reply.outcome }, reply.status);
  });

  return app;
}
