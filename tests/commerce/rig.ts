import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { FakeCheckoutPort } from "../../src/commerce/fake-port";
import type { CheckoutPort } from "../../src/commerce/port";
import { OfferStore } from "../../src/commerce/registry";
import { CommerceService } from "../../src/commerce/service";
import { CommerceStore } from "../../src/commerce/store";
import { signTestPayload } from "../../src/commerce/stripe-port";
import type { CommerceState } from "../../src/core/commerce";
import type { Offer } from "../../src/core/types";
import { harness } from "../server/helpers";
import type { Harness } from "../server/helpers";

export const PORT = 8787;
export const HEADERS = { host: `127.0.0.1:${PORT}`, "content-type": "application/json" };
export const testSecret = (): string => `whsec_${"a1b2c3d4e5f6a7b8c9d0".repeat(2)}`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

export interface RigOptions {
  /** A directory to reuse (a restart); default is a fresh temporary one. */
  dir?: string;
  /** Written to the store before the app starts. */
  seed?: CommerceState;
  /** The port the service uses; `undefined` means checkout is not configured. Default: a FakeCheckoutPort. */
  port?: CheckoutPort | undefined;
  portTimeoutMs?: number;
  secret?: string;
}

export interface Rig {
  dir: string;
  secret: string;
  harness: Harness;
  service: CommerceService;
  offers: OfferStore;
  /** The fake port, whether or not the service uses it. */
  port: FakeCheckoutPort;
  logs: Record<string, unknown>[];
  request: (path: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<Response>;
  json: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
  /** Posts a webhook body with the given Stripe-Signature header, or a valid one made for this rig's secret. */
  signed: (payload: string, header?: string) => Promise<Response>;
  /** A new app and service over the same directory. */
  restart: (options?: Partial<RigOptions>) => Rig;
}

/** The real app, service, store, and registry over a temporary directory, with a fake Stripe port. */
export function commerceRig(options: RigOptions = {}): Rig {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "kensaku-commerce-"));
  if (options.dir === undefined) dirs.push(dir);
  const store = new CommerceStore(join(dir, "data"));
  if (options.seed) store.save(options.seed);
  const offers = new OfferStore({ dir: join(dir, "offers"), clock: () => new Date() });
  const fake = new FakeCheckoutPort(PORT);
  const logs: Record<string, unknown>[] = [];
  const secret = options.secret ?? testSecret();
  const service = new CommerceService({
    store,
    offers,
    port: "port" in options ? options.port : fake,
    clock: () => new Date(),
    log: (line) => logs.push(line),
    serverPort: PORT,
    ...(options.portTimeoutMs !== undefined && { portTimeoutMs: options.portTimeoutMs }),
  });
  const h = harness({ commerce: { service, webhookSecret: secret } });
  const request: Rig["request"] = async (path, init = {}) =>
    h.app.request(path, { method: init.method ?? "GET", headers: { ...HEADERS, ...init.headers }, ...(init.body !== undefined && { body: init.body }) });
  return {
    dir,
    secret,
    harness: h,
    service,
    offers,
    port: fake,
    logs,
    request,
    json: async (method, path, body) => {
      const res = await request(path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    signed: (payload, header) =>
      request("/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header ?? signTestPayload(payload, secret, Math.floor(Date.now() / 1000)) } }),
    restart: (next = {}) => commerceRig({ ...options, seed: undefined, ...next, dir }),
  };
}

/** A merchant offer with its id, as the pipeline registers it. */
export function registrable(partial: Partial<Offer> & { id: string; price: Offer["price"] }): Offer {
  return {
    kind: "merchant-offer",
    merchantHost: "shop.example.com",
    merchantName: "Shop",
    canonicalUrl: `https://shop.example.com/p/${partial.id.slice(0, 8)}`,
    availability: "in_stock",
    source: "exa",
    retrievedAt: "2026-11-23T02:00:00.000Z",
    exaRequestId: "req_test",
    productName: "Widget",
    ...partial,
  };
}
