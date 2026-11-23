import { CheckoutPortError } from "./port";
import type { CheckoutPort, CheckoutSessionOptions, CheckoutSessionParams, SessionResult, SessionStatus } from "./port";

export type CreateScript = "ok" | "error" | "livemode" | `url:${string}`;
export type ExpireScript = "ok" | "ok-delayed" | "error";
export type RetrieveScript = "open" | "complete" | "expired" | "error";

export type FakeCall =
  | { method: "createSession"; params: CheckoutSessionParams; options: CheckoutSessionOptions }
  | { method: "expireSession"; id: string }
  | { method: "retrieveSession"; id: string };

export class FakeCheckoutPort implements CheckoutPort {
  readonly calls: FakeCall[] = [];
  private script = { create: "ok" as CreateScript, expire: "ok" as ExpireScript, retrieve: "open" as RetrieveScript };
  private readonly sessions = new Map<string, { amountTotal: number; currency: string }>();
  private nextId = 1;
  private releaseDelayedExpire: (() => void) | undefined;

  constructor(private readonly serverPort: number) {}

  setScript(next: { createSession?: CreateScript; expireSession?: ExpireScript; retrieveSession?: RetrieveScript }): void {
    if (next.createSession) this.script.create = next.createSession;
    if (next.expireSession) this.script.expire = next.expireSession;
    if (next.retrieveSession) this.script.retrieve = next.retrieveSession;
  }

  count(method: FakeCall["method"]): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  releaseDelayed(): void {
    this.releaseDelayedExpire?.();
  }

  private hostedUrl(id: string): string {
    return `http://127.0.0.1:${this.serverPort}/__test/checkout/${id}`;
  }

  async createSession(params: CheckoutSessionParams, options: CheckoutSessionOptions): Promise<SessionResult> {
    this.calls.push({ method: "createSession", params, options });
    if (this.script.create === "error") throw new CheckoutPortError("stripe-error");
    const id = `cs_fake_${this.nextId++}`;
    const amountTotal = params.line_items.reduce((sum, l) => sum + l.quantity * l.price_data.unit_amount, 0);
    const currency = params.line_items[0]?.price_data.currency ?? "usd";
    this.sessions.set(id, { amountTotal, currency });
    const url = this.script.create.startsWith("url:") ? this.script.create.slice("url:".length) : this.hostedUrl(id);
    return { id, url, status: "open", livemode: this.script.create === "livemode", amountTotal, currency };
  }

  async expireSession(id: string): Promise<void> {
    this.calls.push({ method: "expireSession", id });
    if (this.script.expire === "error") throw new CheckoutPortError("stripe-error");
    if (this.script.expire === "ok-delayed") {
      await new Promise<void>((resolve) => {
        this.releaseDelayedExpire = resolve;
      });
    }
  }

  async retrieveSession(id: string): Promise<SessionResult> {
    this.calls.push({ method: "retrieveSession", id });
    if (this.script.retrieve === "error") throw new CheckoutPortError("stripe-error");
    const status: SessionStatus = this.script.retrieve;
    const known = this.sessions.get(id);
    const fields = { id, livemode: false, amountTotal: known?.amountTotal ?? null, currency: known?.currency ?? null };
    return status === "open" ? { ...fields, status, url: this.hostedUrl(id) } : { ...fields, status, url: null };
  }
}
