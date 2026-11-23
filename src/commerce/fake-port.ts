import { CheckoutPortError } from "./port";
import type { CheckoutPort, CheckoutSessionOptions, CheckoutSessionParams, SessionResult, SessionStatus } from "./port";

/** `url:<value>` deliberately returns a url the real port would refuse, for client-side url checks. */
export type CreateScript = "ok" | "error" | "livemode" | `url:${string}`;
export type ExpireScript = "ok" | "ok-delayed" | "error";
export type RetrieveScript = "open" | "complete" | "expired" | "error";

export type FakeCall =
  | { method: "createSession"; params: CheckoutSessionParams; options: CheckoutSessionOptions }
  | { method: "expireSession"; id: string }
  | { method: "retrieveSession"; id: string };

export interface FakeScript {
  createSession?: CreateScript;
  expireSession?: ExpireScript;
  retrieveSession?: RetrieveScript;
}

export class FakeCheckoutPort implements CheckoutPort {
  readonly calls: FakeCall[] = [];
  private script: Required<FakeScript> = { createSession: "ok", expireSession: "ok", retrieveSession: "open" };
  private readonly sessions = new Map<string, { amountTotal: number; currency: string }>();
  private nextId = 1;
  private readonly delayedExpires: (() => void)[] = [];

  constructor(private readonly serverPort: number) {}

  setScript(next: FakeScript): void {
    Object.assign(this.script, next);
  }

  count(method: FakeCall["method"]): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  releaseDelayed(): void {
    for (const release of this.delayedExpires.splice(0)) release();
  }

  private hostedUrl(id: string): string {
    return `http://127.0.0.1:${this.serverPort}/__test/checkout/${id}`;
  }

  async createSession(params: CheckoutSessionParams, options: CheckoutSessionOptions): Promise<SessionResult> {
    this.calls.push({ method: "createSession", params, options });
    const outcome = this.script.createSession;
    if (outcome === "error") throw new CheckoutPortError("stripe-error");
    if (outcome === "livemode") throw new CheckoutPortError("livemode-refused");
    const id = `cs_fake_${this.nextId++}`;
    const amountTotal = params.line_items.reduce((sum, l) => sum + l.quantity * l.price_data.unit_amount, 0);
    const currency = params.line_items[0]?.price_data.currency ?? "usd";
    this.sessions.set(id, { amountTotal, currency });
    const url = outcome.startsWith("url:") ? outcome.slice("url:".length) : this.hostedUrl(id);
    return { id, url, status: "open", livemode: false, amountTotal, currency };
  }

  async expireSession(id: string): Promise<void> {
    this.calls.push({ method: "expireSession", id });
    const outcome = this.script.expireSession;
    if (outcome === "error") throw new CheckoutPortError("stripe-error");
    if (outcome === "ok-delayed") {
      await new Promise<void>((resolve) => this.delayedExpires.push(resolve));
    }
  }

  async retrieveSession(id: string): Promise<SessionResult> {
    this.calls.push({ method: "retrieveSession", id });
    const status: SessionStatus | "error" = this.script.retrieveSession;
    if (status === "error") throw new CheckoutPortError("stripe-error");
    const known = this.sessions.get(id);
    const fields = { id, livemode: false as const, amountTotal: known?.amountTotal ?? null, currency: known?.currency ?? null };
    return status === "open" ? { ...fields, status, url: this.hostedUrl(id) } : { ...fields, status, url: null };
  }
}
