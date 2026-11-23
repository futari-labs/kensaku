import { randomUUID } from "node:crypto";
import { applyCartOp, cartTotalMinor, createOrder, transitionOrder } from "../core/commerce";
import type { Cart, CartOp, CartResult, CheckoutErrorCode, CommerceState, Order } from "../core/commerce";
import type { Clock } from "../exa/clock";
import { CheckoutPortError } from "./port";
import type { CheckoutPort, SessionResult, WebhookEvent } from "./port";
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
  | { ok: false; code: CheckoutErrorCode };

export type CancelResult =
  | { ok: true; order: Order }
  | { ok: false; code: "order-not-found" | "already-paid" | "already-completed" | "cancel-failed" };

/** `unconfirmed`: Stripe was not reached, or the session is still open after expiring it failed. */
type SessionClose = "closed" | "completed" | "unconfirmed";

export interface CommerceOptions {
  store: CommerceStore;
  offers: OfferStore;
  /** Absent: checkout is not configured, and the cart still works. */
  port: CheckoutPort | undefined;
  /** Whether the runtime offers checkout right now; with no port it is never true. */
  checkoutConfigured: () => boolean;
  clock: Clock;
  log: (line: Record<string, unknown>) => void;
  serverPort: number;
  portTimeoutMs?: number;
}

/**
 * The server's one cart and its orders. Every mutation runs on a single promise chain, awaited Stripe calls
 * included, so a webhook that arrives during a cancel or checkout is applied after it (EV-020 `serialization`).
 * Reads see the last committed state and never wait.
 */
export class CommerceService {
  readonly unavailableReason: string | undefined;
  protected state: CommerceState;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly portTimeoutMs: number;

  constructor(private readonly options: CommerceOptions) {
    const loaded = options.store.load();
    this.unavailableReason = loaded.ok ? undefined : loaded.reason;
    this.state = loaded.ok ? loaded.state : emptyState();
    this.portTimeoutMs = options.portTimeoutMs ?? PORT_TIMEOUT_MS;
    if (!loaded.ok) options.log({ event: "commerce_disabled", reason: loaded.reason });
  }

  cart(): { cart: Cart; totalMinor: number; checkoutConfigured: boolean } {
    const { cart } = this.state;
    return { cart, totalMinor: cartTotalMinor(cart), checkoutConfigured: this.options.port !== undefined && this.options.checkoutConfigured() };
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

  protected enqueue<T>(job: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(job);
    this.tail = result.catch(() => undefined);
    return result;
  }

  protected commit(next: CommerceState): void {
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

  private async closeSession(order: Order): Promise<SessionClose> {
    const { port } = this.options;
    const id = order.stripeSessionId;
    if (port === undefined || id === null) return "unconfirmed";
    try {
      await this.withTimeout(() => port.expireSession(id));
      return "closed";
    } catch {
      // Expiring failed: ask Stripe what the session is now.
    }
    let session: SessionResult;
    try {
      session = await this.withTimeout(() => port.retrieveSession(id));
    } catch {
      return "unconfirmed";
    }
    return session.status === "open" ? "unconfirmed" : session.status === "complete" ? "completed" : "closed";
  }

  checkout(): Promise<CheckoutResult> {
    return this.enqueue(async () => {
      const { port } = this.options;
      const fail = (code: CheckoutErrorCode, extra: Record<string, unknown> = {}): CheckoutResult => {
        this.options.log({ event: "checkout", result: code, ...extra });
        return { ok: false, code };
      };
      const { cart } = this.state;
      if (port === undefined || !this.options.checkoutConfigured()) return fail("checkout-not-configured");
      if (cart.currency === null) return fail("cart-empty");

      for (const prior of this.state.orders.filter((o) => o.state === "open")) {
        const closed = await this.closeSession(prior);
        if (closed === "unconfirmed") return fail("checkout-failed", { orderId: prior.orderId, stage: "supersede" });
        if (closed === "closed") this.replaceOrder(transitionOrder(prior, { kind: "supersede" }, this.options.clock().toISOString()).order);
      }

      const now = this.options.clock();
      const at = now.toISOString();
      const orderId = `ord_${randomUUID()}`;
      const fields = { orderId, currency: cart.currency, lines: cart.lines, totalMinor: cartTotalMinor(cart), cartVersion: cart.version, createdAt: at };
      const { params, options } = buildCheckoutSessionRequest({ orderId, currency: cart.currency, lines: cart.lines }, { port: this.options.serverPort, now });
      try {
        const session = await this.withTimeout(() => port.createSession(params, options));
        if (session.status !== "open") throw new CheckoutPortError("stripe-error");
        const expiresAt = new Date(params.expires_at * 1000).toISOString();
        this.commit({ ...this.state, orders: [...this.state.orders, createOrder({ ...fields, stripeSessionId: session.id, expiresAt }, "open", at)] });
        this.options.log({ event: "checkout", orderId, sessionId: session.id, result: "ok" });
        return { ok: true, orderId, url: session.url };
      } catch {
        this.commit({ ...this.state, orders: [...this.state.orders, createOrder({ ...fields, stripeSessionId: null, expiresAt: null }, "failed", at)] });
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
      const closed = await this.closeSession(order);
      if (closed === "completed") return done({ ok: false, code: "already-completed" }, "already-completed");
      if (closed === "unconfirmed") return done({ ok: false, code: "cancel-failed" }, "cancel-failed");
      const cancelled = transitionOrder(order, { kind: "cancel" }, this.options.clock().toISOString()).order;
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
}
