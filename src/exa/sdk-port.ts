import Exa from "exa-js";
import type { ExaTransport } from "./guarded-port";
import { GuardedExaPort } from "./guarded-port";
import type { PortOptions } from "./guarded-port";
import type { UsageLedger } from "./ledger";

export const EXA_CALL_TIMEOUT_MS = 30_000;

interface CallOptions {
  signal: AbortSignal;
  timeout: number;
}

/** The two SDK methods the port uses. Tests pass a fake; production passes `Exa` through `fromApiKey`. */
export interface ExaClientLike {
  answer(query: string, options: Record<string, unknown>, call: CallOptions): Promise<unknown>;
  search(query: string, options: Record<string, unknown>, call: CallOptions): Promise<unknown>;
}

export interface SdkPortOptions extends PortOptions {
  client: ExaClientLike;
  /** Required: a live port must never exist without monthly limits and the credits-exhausted stop. */
  ledger: UsageLedger;
  timeoutMs?: number;
}

function sdkTransport(client: ExaClientLike, timeoutMs: number): ExaTransport {
  return {
    answer: ({ query, ...options }, signal) => client.answer(query, options, { signal, timeout: timeoutMs }),
    search: ({ query, options }, signal) => client.search(query, options, { signal, timeout: timeoutMs }),
  };
}

/** The only module that imports `exa-js`. It holds a client, never the API key. */
export class ExaSdkPort extends GuardedExaPort {
  constructor({ client, timeoutMs = EXA_CALL_TIMEOUT_MS, ...options }: SdkPortOptions) {
    super(sdkTransport(client, timeoutMs), options);
  }

  /** The key goes to the SDK constructor and nowhere else. */
  static fromApiKey(apiKey: string, options: Omit<SdkPortOptions, "client">): ExaSdkPort {
    const exa = new Exa(apiKey);
    const client: ExaClientLike = {
      answer: (query, opts, call) => exa.answer(query, opts, call),
      search: (query, opts, call) => exa.search(query, opts as never, call),
    };
    return new ExaSdkPort({ ...options, client });
  }
}
