import Stripe from "stripe";
import { CheckoutPortError } from "./port";
import type { CheckoutPort, CheckoutSessionOptions, CheckoutSessionParams, SessionResult, SessionStatus } from "./port";

export const STRIPE_API_VERSION = "2026-10-28.endive";
const CHECKOUT_URL_PREFIX = "https://checkout.stripe.com/";
const WEBHOOK_TOLERANCE_SECONDS = 300;
const STATUSES: readonly SessionStatus[] = ["open", "complete", "expired"];

/** The slice of the SDK client this port uses; tests stub it. */
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
  if (session.url !== null && !session.url.startsWith(CHECKOUT_URL_PREFIX)) throw new CheckoutPortError("unsafe-url");
  return {
    id: session.id,
    url: session.url,
    status,
    livemode: false,
    amountTotal: session.amount_total,
    currency: session.currency,
  };
}

/** Runs one SDK call, collapsing every failure but our own refusals into one typed error. */
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
    if (result.url === null) throw new CheckoutPortError("stripe-error");
    return result;
  }

  /** Any failure is one `stripe-error`: the shape for a non-open session is unknown until the JM-203 smoke. */
  async expireSession(id: string): Promise<void> {
    await call(() => this.client.checkout.sessions.expire(id));
  }

  retrieveSession(id: string): Promise<SessionResult> {
    return call(async () => toResult(await this.client.checkout.sessions.retrieve(id)));
  }
}

/** Verifies the signature and age of a raw webhook body offline and returns the parsed event. */
export function verifyWebhook(rawBody: string | Uint8Array, header: string, secret: string): Stripe.Event {
  try {
    return Stripe.webhooks.constructEvent(rawBody, header, secret, WEBHOOK_TOLERANCE_SECONDS);
  } catch {
    throw new CheckoutPortError("invalid-signature");
  }
}

/** For tests and the test-only fake hosted page: a valid `Stripe-Signature` header for `payload`. */
export function signTestPayload(payload: string, secret: string, timestamp: number): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}
