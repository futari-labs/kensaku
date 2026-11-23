import type { CheckoutOrderInput, CheckoutSessionOptions, CheckoutSessionParams } from "./port";

const NAME_PREFIX = "Simulated: ";
const NAME_MAX_CODE_POINTS = 120;
const EXPIRY_SECONDS = 3600;

const productName = (raw: string) => Array.from(raw.trim()).slice(0, NAME_MAX_CODE_POINTS).join("").trim();

const description = (host: string, retrievedAt: string) =>
  `Simulated Kensaku purchase in a Stripe sandbox. No order is placed with ${host} and no real payment is taken. Demo price copied from the price last observed on ${host} at ${retrievedAt}.`;

export function buildCheckoutSessionRequest(
  order: CheckoutOrderInput,
  context: { port: number; now: Date },
): { params: CheckoutSessionParams; options: CheckoutSessionOptions } {
  const origin = `http://127.0.0.1:${context.port}`;
  return {
    params: {
      mode: "payment",
      line_items: order.lines.map((line) => ({
        quantity: line.quantity,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: line.demoUnitAmountMinor,
          product_data: {
            name: NAME_PREFIX + productName(line.productName),
            description: description(line.observed.merchantHost, line.observed.retrievedAt),
          },
        },
      })),
      client_reference_id: order.orderId,
      metadata: { kensaku_order_id: order.orderId, kensaku_simulated: "true", kensaku_plan: "kensaku-v1-2" },
      payment_intent_data: {
        description: "Simulated Kensaku purchase. No merchant order is placed.",
        metadata: { kensaku_order_id: order.orderId, kensaku_simulated: "true" },
      },
      success_url: `${origin}/?checkout=success&order=${order.orderId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled&order=${order.orderId}`,
      expires_at: Math.floor(context.now.getTime() / 1000) + EXPIRY_SECONDS,
      adaptive_pricing: { enabled: false },
    },
    options: { idempotencyKey: `kensaku-order-${order.orderId}` },
  };
}
