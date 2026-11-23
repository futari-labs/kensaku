import Stripe from "stripe";
import { CheckoutPortError } from "./port";
import type { CheckoutPort, CheckoutSessionOptions, CheckoutSessionParams, SessionResult, SessionStatus } from "./port";

export const STRIPE_API_VERSION = "2026-10-28.endive";
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

export type StripeClientFactory = (secretKey: string) => StripeClientLike;

const sdkClient: StripeClientFactory = (secretKey) =>
  new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, timeout: 10000, maxNetworkRetries: 0 });

function toResult(session: Stripe.Checkout.Session): SessionResult {
  if (session.livemode) throw new CheckoutPortError("livemode-refused");
  const status = STATUSES.find((known) => known === session.status);
  if (status === undefined) throw new CheckoutPortError("stripe-error");
  const fields = { id: session.id, livemode: false, amountTotal: session.amount_total, currency: session.currency };
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
  private readonly client: StripeClientLike;

  constructor(secretKey: string, clientFactory: StripeClientFactory = sdkClient) {
    this.client = clientFactory(secretKey);
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

export function verifyWebhook(rawBody: string | Uint8Array, header: string, secret: string): Stripe.Event {
  try {
    return Stripe.webhooks.constructEvent(rawBody, header, secret, WEBHOOK_TOLERANCE_SECONDS);
  } catch {
    throw new CheckoutPortError("invalid-signature");
  }
}

export function signTestPayload(payload: string, secret: string, timestamp: number): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}
