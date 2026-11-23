import Stripe from "stripe";
import { z } from "zod";
import { CheckoutPortError } from "./port";
import type {
  CheckoutPort,
  CheckoutSessionOptions,
  CheckoutSessionParams,
  SessionResult,
  SessionStatus,
  WebhookEvent,
} from "./port";

const STRIPE_API_VERSION = "2026-10-28.endive";
const CHECKOUT_URL_PREFIX = "https://checkout.stripe.com/";
const WEBHOOK_TOLERANCE_SECONDS = 300;
const STATUSES: readonly SessionStatus[] = ["open", "complete", "expired"];

export interface StripeClientLike {
  checkout: {
    sessions: {
      create(params: CheckoutSessionParams, options: CheckoutSessionOptions): Promise<Stripe.Checkout.Session>;
      expire(id: string): Promise<unknown>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
}

function toResult(session: Stripe.Checkout.Session): SessionResult {
  if (session.livemode) throw new CheckoutPortError("livemode-refused");
  const status = STATUSES.find((known) => known === session.status);
  if (status === undefined) throw new CheckoutPortError("stripe-error");
  const fields = { id: session.id, livemode: false as const, amountTotal: session.amount_total, currency: session.currency };
  if (status !== "open") return { ...fields, status, url: null };
  if (session.url === null) throw new CheckoutPortError("stripe-error");
  if (!session.url.startsWith(CHECKOUT_URL_PREFIX)) throw new CheckoutPortError("unsafe-url");
  return { ...fields, status, url: session.url };
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof CheckoutPortError ? error : new CheckoutPortError("stripe-error");
  }
}

export class StripeCheckoutPort implements CheckoutPort {
  constructor(private readonly client: StripeClientLike) {}

  /** The key goes to the SDK constructor and nowhere else. */
  static fromSecretKey(key: string): StripeCheckoutPort {
    return new StripeCheckoutPort(new Stripe(key, { apiVersion: STRIPE_API_VERSION, timeout: 10000, maxNetworkRetries: 0 }));
  }

  async createSession(params: CheckoutSessionParams, options: CheckoutSessionOptions): Promise<SessionResult> {
    const result = await call(async () => toResult(await this.client.checkout.sessions.create(params, options)));
    if (result.status !== "open") throw new CheckoutPortError("stripe-error");
    return result;
  }

  async expireSession(id: string): Promise<void> {
    await call(() => this.client.checkout.sessions.expire(id));
  }

  retrieveSession(id: string): Promise<SessionResult> {
    return call(async () => toResult(await this.client.checkout.sessions.retrieve(id)));
  }
}

const webhookEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  livemode: z.boolean(),
  data: z.object({
    object: z.object({
      id: z.string().optional(),
      object: z.string().optional(),
      client_reference_id: z.string().nullish(),
      status: z.string().nullish(),
      payment_status: z.string().nullish(),
      amount_total: z.number().nullish(),
      currency: z.string().nullish(),
      livemode: z.boolean().optional(),
      metadata: z.record(z.string(), z.string()).nullish(),
    }),
  }),
});

/** Signature failures are invalid-signature; a correctly signed body that is not an event is invalid-payload. */
export function verifyWebhook(rawBody: string | Uint8Array, header: string | undefined, secret: string): WebhookEvent {
  if (!header) throw new CheckoutPortError("invalid-signature");
  let event: unknown;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, header, secret, WEBHOOK_TOLERANCE_SECONDS);
  } catch (error) {
    throw new CheckoutPortError(error instanceof Stripe.errors.StripeSignatureVerificationError ? "invalid-signature" : "invalid-payload");
  }
  const parsed = webhookEventSchema.safeParse(event);
  if (!parsed.success) throw new CheckoutPortError("invalid-payload");
  const { id, type, livemode, data } = parsed.data;
  return { id, type, livemode, object: data.object };
}

export function signTestPayload(payload: string, secret: string, timestamp: number): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}
