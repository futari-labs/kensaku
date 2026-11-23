import { randomUUID } from "node:crypto";
import { applyCartOp, cartTotalMinor } from "../core/commerce";
import type { Cart, CartOp, CartResult, CommerceState, Order, OrderState } from "../core/commerce";
import type { Market, Offer } from "../core/types";
import type { Clock } from "../exa/clock";
import { CheckoutPortError } from "./port";
import type { CheckoutPort, WebhookEvent } from "./port";
import type { OfferStore } from "./registry";
import { buildCheckoutSessionRequest } from "./session-request";
import { emptyState } from "./store";
import type { CommerceStore } from "./store";
import { applyWebhookEvent, handleWebhook } from "./webhook";
import type { WebhookInput, WebhookReply, WebhookResult } from "./webhook";

export const PORT_TIMEOUT_MS = 10_000;
const MAX_LISTED_ORDERS = 10;

export type CheckoutResult =
  | { ok: true; orderId: string; url: string }
  | { ok: false; code: "cart-empty" | "checkout-not-configured" | "checkout-failed" };

export type CancelResult =
  | { ok: true; order: Order }
  | { ok: false; code: "order-not-found" | "already-paid" | "already-completed" | "cancel-failed" };

type SessionFate = "expired" | "complete" | "unknown";

export interface CommerceOptions {
  store: CommerceStore;
  offers: OfferStore;
  /** Absent: checkout is not configured, and the cart still works. */
  port: CheckoutPort | undefined;
  clock: Clock;
  log: (line: Record<string, unknown>) => void;
  serverPort: number;
  portTimeoutMs?: number;
}

const moved = (order: Order, to: OrderState, at: string, extra: Partial<Order> = {}): Order => ({
  ...order,
  ...extra,
  state: to,
  awaitingAsyncPayment: false,
  updatedAt: at,
  transitions: [...order.transitions, { at, from: order.state, to }],
});

/**
 * The server's one cart and its orders. Every mutation runs on a single promise chain, awaited Stripe calls
 * included, so a webhook that arrives during a cancel or checkout is applied after it (EV-020 `serialization`).
 * Reads see the last committed state and never wait.
 */
export class CommerceService {
  readonly unavailableReason: string | undefined;
  private state: CommerceState;
  private tail: Promise<unknown> = Promise.resolve();
  private checkoutEnabled: boolean;
  private readonly portTimeoutMs: number;

  constructor(private readonly options: CommerceOptions) {
    const loaded = options.store.load();
    this.unavailableReason = loaded.ok ? undefined : loaded.reason;
    this.state = loaded.ok ? loaded.state : emptyState();
    this.checkoutEnabled = options.port !== undefined;
    this.portTimeoutMs = options.portTimeoutMs ?? PORT_TIMEOUT_MS;
    if (!loaded.ok) options.log({ event: "commerce_disabled", reason: loaded.reason });
  }

  get checkoutConfigured(): boolean {
    return this.checkoutEnabled;
  }

  setCheckoutConfigured(value: boolean): void {
    this.checkoutEnabled = value && this.options.port !== undefined;
  }

  registerOffers(offers: readonly Offer[], market: Market): void {
    this.options.offers.register(offers, market);
  }

  cart(): { cart: Cart; totalMinor: number; checkoutConfigured: boolean } {
    const { cart } = this.state;
    return { cart, totalMinor: cartTotalMinor(cart), checkoutConfigured: this.checkoutEnabled };
  }

  orders(): Order[] {
    return this.state.orders.slice(-MAX_LISTED_ORDERS).reverse();
  }

  order(id: string): Order | undefined {
    return this.state.orders.find((o) => o.orderId === id);
  }

  orderBySession(sessionId: string): Order | undefined {
    return this.state.orders.find((o) => o.stripeSessionId === sessionId);
  }

  private enqueue<T>(job: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(job);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private commit(next: CommerceState): void {
    this.options.store.save(next);
    this.state = next;
  }

  private replaceOrder(updated: Order): void {
    this.commit({ ...this.state, orders: this.state.orders.map((o) => (o.orderId === updated.orderId ? updated : o)) });
  }

  private withTimeout<T>(call: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CheckoutPortError("stripe-error")), this.portTimeoutMs);
    });
    return Promise.race([call(), timeout]).finally(() => clearTimeout(timer));
  }

  applyCartOp(op: CartOp): Promise<CartResult> {
    return this.enqueue(() => {
      const result = applyCartOp(this.state.cart, op, this.options.offers.get);
      if (result.ok && result.cart !== this.state.cart) this.commit({ ...this.state, cart: result.cart });
      this.options.log({ event: "cart", op: op.kind, result: result.ok ? "ok" : result.code });
      return result;
    });
  }

  private async fateOfSession(order: Order): Promise<SessionFate> {
    const { port } = this.options;
    if (order.stripeSessionId === null || port === undefined) return "expired";
    const id = order.stripeSessionId;
    try {
      await this.withTimeout(() => port.expireSession(id));
      return "expired";
    } catch {
      try {
        const session = await this.withTimeout(() => port.retrieveSession(id));
        return session.status === "open" ? "unknown" : session.status;
      } catch {
        return "unknown";
      }
    }
  }

  checkout(): Promise<CheckoutResult> {
    return this.enqueue(async () => {
      const { port } = this.options;
      const fail = (code: Extract<CheckoutResult, { ok: false }>["code"], extra: Record<string, unknown> = {}): CheckoutResult => {
        this.options.log({ event: "checkout", result: code, ...extra });
        return { ok: false, code };
      };
      if (port === undefined || !this.checkoutEnabled) return fail("checkout-not-configured");
      if (this.state.cart.lines.length === 0) return fail("cart-empty");

      for (const prior of this.state.orders.filter((o) => o.state === "open")) {
        const fate = await this.fateOfSession(prior);
        if (fate === "unknown") return fail("checkout-failed", { orderId: prior.orderId, stage: "supersede" });
        if (fate === "expired") this.replaceOrder(moved(prior, "expired", this.options.clock().toISOString(), { reason: "superseded" }));
      }

      const { cart } = this.state;
      if (cart.currency === null) return fail("cart-empty");
      const now = this.options.clock();
      const at = now.toISOString();
      const orderId = `ord_${randomUUID()}`;
      const base = {
        orderId,
        currency: cart.currency,
        lines: cart.lines,
        totalMinor: cartTotalMinor(cart),
        cartVersion: cart.version,
        declinedAttempts: 0,
        awaitingAsyncPayment: false,
        createdAt: at,
        updatedAt: at,
      };
      const { params, options } = buildCheckoutSessionRequest({ orderId, currency: cart.currency, lines: cart.lines }, { port: this.options.serverPort, now });
      try {
        const session = await this.withTimeout(() => port.createSession(params, options));
        if (session.status !== "open") throw new CheckoutPortError("stripe-error");
        this.commit({
          ...this.state,
          orders: [
            ...this.state.orders,
            { ...base, state: "open", stripeSessionId: session.id, expiresAt: new Date(params.expires_at * 1000).toISOString(), transitions: [{ at, from: null, to: "open" }] },
          ],
        });
        this.options.log({ event: "checkout", orderId, sessionId: session.id, result: "ok" });
        return { ok: true, orderId, url: session.url };
      } catch {
        this.commit({
          ...this.state,
          orders: [...this.state.orders, { ...base, state: "failed", stripeSessionId: null, expiresAt: null, transitions: [{ at, from: null, to: "failed" }] }],
        });
        return fail("checkout-failed", { orderId });
      }
    });
  }

  cancel(orderId: string): Promise<CancelResult> {
    return this.enqueue(async () => {
      const order = this.order(orderId);
      const done = (result: CancelResult, label: string): CancelResult => {
        this.options.log({ event: "cancel", orderId, result: label });
        return result;
      };
      if (!order) return done({ ok: false, code: "order-not-found" }, "order-not-found");
      if (order.state === "paid") return done({ ok: false, code: "already-paid" }, "already-paid");
      if (order.state !== "open") return done({ ok: true, order }, "unchanged");
      const fate = await this.fateOfSession(order);
      if (fate === "complete") return done({ ok: false, code: "already-completed" }, "already-completed");
      if (fate === "unknown") return done({ ok: false, code: "cancel-failed" }, "cancel-failed");
      const cancelled = moved(order, "cancelled", this.options.clock().toISOString());
      this.replaceOrder(cancelled);
      return done({ ok: true, order: cancelled }, "cancelled");
    });
  }

  deliver(input: WebhookInput): Promise<WebhookReply> {
    return handleWebhook(input, (event) => this.applyWebhook(event), this.options.log);
  }

  private applyWebhook(event: WebhookEvent): Promise<WebhookResult> {
    return this.enqueue(() => {
      const result = applyWebhookEvent(this.state, event, this.options.clock());
      if (result.state !== this.state) this.commit(result.state);
      return result;
    });
  }

  reset(): Promise<void> {
    return this.enqueue(() => {
      this.commit(emptyState());
      this.setCheckoutConfigured(true);
    });
  }

  expireOpenOrder(): Promise<boolean> {
    return this.enqueue(() => {
      const open = this.state.orders.findLast((o) => o.state === "open");
      if (!open) return false;
      this.replaceOrder({ ...open, expiresAt: new Date(this.options.clock().getTime() - 60_000).toISOString() });
      return true;
    });
  }
}
