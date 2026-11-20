import { createApp } from "../../src/server/app";
import type { AppDeps, LogLine } from "../../src/server/app";
import type { AppConfig } from "../../src/server/config";
import { FixtureExaPort } from "../../src/exa/fixture-port";
import type { ExaPort } from "../../src/exa/port";
import { fakeClock, storage } from "../exa/helpers";
import { Q1 } from "../fixtures/questions";

export const START = "2026-11-21T10:00:00Z";

export interface Harness {
  app: ReturnType<typeof createApp>;
  logs: LogLine[];
  /** Every fixture port built, in request order. */
  ports: FixtureExaPort[];
  clock: ReturnType<typeof fakeClock>;
  store: ReturnType<typeof storage>;
  post: (body: Record<string, unknown>, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;
  chat: (scenario?: string, init?: { signal?: AbortSignal }) => Promise<Response>;
}

export interface HarnessOptions {
  cache?: boolean;
  mode?: AppConfig["mode"];
  /** Wraps each fixture port, e.g. to spy on calls. */
  wrap?: (port: FixtureExaPort) => ExaPort;
  portFor?: AppDeps["portFor"];
  limits?: { requestLimit?: number; costLimit?: number };
  run?: AppDeps["run"];
}

export function harness(options: HarnessOptions = {}): Harness {
  const clock = fakeClock(START);
  const store = storage(clock, options.limits);
  const logs: LogLine[] = [];
  const ports: FixtureExaPort[] = [];
  const mode = options.mode ?? "fixture";
  const deps: AppDeps = {
    config: { mode, dev: false, port: 8787, exaConfigured: mode === "live" },
    ledger: store.ledger,
    clock,
    log: (line) => logs.push(line),
    run: { sleep: () => Promise.resolve(), ...options.run },
    portFor:
      options.portFor ??
      ((scenario) => {
        const port = FixtureExaPort.load(scenario ?? "xm5-us", { ledger: store.ledger, clock, ...(options.cache && { cache: store.cache }) });
        ports.push(port);
        return options.wrap ? options.wrap(port) : port;
      }),
  };
  const app = createApp(deps);
  const post: Harness["post"] = async (body, init = {}) =>
    app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:8787", ...init.headers },
      body: JSON.stringify(body),
      ...(init.signal && { signal: init.signal }),
    });
  const chat: Harness["chat"] = (scenario, init) =>
    post(
      { messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: Q1 }] }], market: "US", ...(scenario && { fixtureScenario: scenario }) },
      init,
    );
  return { app, logs, ports, clock, store, post, chat };
}
