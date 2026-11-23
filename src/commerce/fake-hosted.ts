import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { Order } from "../core/commerce";
import { formatMinor } from "../core/commerce";
import type { Clock } from "../exa/clock";
import type { CommerceService } from "./service";
import { signTestPayload } from "./stripe-port";

export interface FakeHostedOptions {
  service: CommerceService;
  secret: string;
  clock: Clock;
}

const FlagSchema = z.object({ value: z.boolean() }).strict();

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const encoder = new TextEncoder();

function eventBody(id: string, type: string, object: Record<string, unknown>, now: Date): string {
  return JSON.stringify({ id, object: "event", api_version: "2026-10-28.endive", created: Math.floor(now.getTime() / 1000), livemode: false, type, data: { object } });
}

function page(order: Order, declined: boolean): string {
  const lines = order.lines
    .map((line) => `<li>${escapeHtml(`Simulated: ${line.productName}`)} x ${line.quantity}: ${formatMinor(line.demoUnitAmountMinor * line.quantity, order.currency)} ${order.currency}</li>`)
    .join("");
  const id = encodeURIComponent(order.stripeSessionId ?? "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fake Stripe Checkout (test only)</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem">
<main>
<h1>Fake Stripe Checkout</h1>
<p>Test-only page standing in for the Stripe-hosted page. No card is taken.</p>
<ul>${lines}</ul>
<p>Total ${formatMinor(order.totalMinor, order.currency)} ${order.currency}</p>
${declined ? `<p role="alert">Your card was declined.</p>` : ""}
<form method="post" action="/__test/checkout/${id}/pay" style="display:inline"><button type="submit">Pay</button></form>
<form method="post" action="/__test/checkout/${id}/decline" style="display:inline"><button type="submit">Decline</button></form>
<a href="/?checkout=cancelled&amp;order=${encodeURIComponent(order.orderId)}">Back</a>
</main></body></html>`;
}

export function fakeHostedRoutes({ service, secret, clock }: FakeHostedOptions): Hono {
  const app = new Hono();
  let withhold = false;

  const deliver = async (type: string, eventId: string, object: Record<string, unknown>): Promise<void> => {
    if (withhold) return;
    const now = clock();
    const payload = eventBody(eventId, type, object, now);
    await service.deliver({ rawBody: encoder.encode(payload), signature: signTestPayload(payload, secret, Math.floor(now.getTime() / 1000)), secret });
  };

  const sessionObject = (order: Order) => ({
    id: order.stripeSessionId,
    object: "checkout.session",
    client_reference_id: order.orderId,
    status: "complete",
    payment_status: "paid",
    amount_total: order.totalMinor,
    currency: order.currency.toLowerCase(),
    livemode: false,
    metadata: { kensaku_order_id: order.orderId, kensaku_simulated: "true" },
  });

  app.get("/__test/checkout/:id", (c) => {
    const order = service.orderBySession(c.req.param("id"));
    return order ? c.html(page(order, c.req.query("declined") === "1")) : c.text("Unknown session", 404);
  });

  app.post("/__test/checkout/:id/pay", async (c) => {
    const order = service.orderBySession(c.req.param("id"));
    if (!order?.stripeSessionId) return c.text("Unknown session", 404);
    await deliver("checkout.session.completed", `evt_fake_completed_${order.stripeSessionId}`, sessionObject(order));
    return c.redirect(`/?checkout=success&order=${order.orderId}&session_id=${order.stripeSessionId}`, 303);
  });

  app.post("/__test/checkout/:id/decline", async (c) => {
    const order = service.orderBySession(c.req.param("id"));
    if (!order?.stripeSessionId) return c.text("Unknown session", 404);
    const failed = {
      id: `pi_fake_${order.stripeSessionId}`,
      object: "payment_intent",
      amount: order.totalMinor,
      currency: order.currency.toLowerCase(),
      livemode: false,
      metadata: { kensaku_order_id: order.orderId, kensaku_simulated: "true" },
      last_payment_error: { code: "card_declined", decline_code: "generic_decline" },
    };
    await deliver("payment_intent.payment_failed", `evt_fake_declined_${order.stripeSessionId}_${order.declinedAttempts + 1}`, failed);
    return c.redirect(`/__test/checkout/${encodeURIComponent(order.stripeSessionId)}?declined=1`, 303);
  });

  const flag = async (c: Context): Promise<boolean | undefined> => {
    const parsed = FlagSchema.safeParse(await c.req.json().catch(() => undefined));
    return parsed.success ? parsed.data.value : undefined;
  };

  app.post("/__test/commerce/reset", async (c) => {
    await service.reset();
    withhold = false;
    return c.json({ ok: true });
  });

  app.post("/__test/commerce/checkout-configured", async (c) => {
    const value = await flag(c);
    if (value === undefined) return c.json({ code: "invalid-request" }, 400);
    service.setCheckoutConfigured(value);
    return c.json({ checkoutConfigured: service.checkoutConfigured });
  });

  app.post("/__test/commerce/withhold-webhooks", async (c) => {
    const value = await flag(c);
    if (value === undefined) return c.json({ code: "invalid-request" }, 400);
    withhold = value;
    return c.json({ withhold });
  });

  app.post("/__test/commerce/expire-open-order", async (c) => ((await service.expireOpenOrder()) ? c.json({ ok: true }) : c.json({ code: "no-open-order" }, 404)));

  return app;
}
