/** Structural input for the session request. Kept local so this module does not depend on the core commerce types. */
export interface CheckoutOrderLine {
  productName: string;
  merchantHost: string;
  quantity: number;
  demoUnitAmountMinor: number;
  observed: { amount: number; currency: string; retrievedAt: string; merchantHost: string };
}

export interface CheckoutOrderInput {
  orderId: string;
  currency: string;
  lines: readonly CheckoutOrderLine[];
}

export interface CheckoutSessionParams {
  mode: "payment";
  line_items: {
    quantity: number;
    price_data: { currency: string; unit_amount: number; product_data: { name: string; description: string } };
  }[];
  client_reference_id: string;
  metadata: Record<string, string>;
  payment_intent_data: { description: string; metadata: Record<string, string> };
  success_url: string;
  cancel_url: string;
  expires_at: number;
  adaptive_pricing: { enabled: false };
}

export interface CheckoutSessionOptions {
  idempotencyKey: string;
}

export type SessionStatus = "open" | "complete" | "expired";

export interface SessionResult {
  id: string;
  /** Null once a session is no longer payable. */
  url: string | null;
  status: SessionStatus;
  livemode: boolean;
  amountTotal: number | null;
  currency: string | null;
}

export type CheckoutPortErrorCode = "stripe-error" | "livemode-refused" | "unsafe-url" | "invalid-signature";

/** Carries a code only: never the SDK's message, which can quote part of a key. */
export class CheckoutPortError extends Error {
  constructor(readonly code: CheckoutPortErrorCode) {
    super(code);
    this.name = "CheckoutPortError";
  }
}

export interface CheckoutPort {
  createSession(params: CheckoutSessionParams, options: CheckoutSessionOptions): Promise<SessionResult>;
  expireSession(id: string): Promise<void>;
  retrieveSession(id: string): Promise<SessionResult>;
}
