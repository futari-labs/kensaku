import { vi } from "vitest";
import { createApp } from "../../src/server/app";
import type { AppDeps } from "../../src/server/app";
import { parseConfig } from "../../src/server/config";
import { createRuntime } from "../../src/server/runtime";
import { Q1 } from "../fixtures/questions";

export interface RuntimeApp {
  deps: AppDeps;
  app: ReturnType<typeof createApp>;
  /** Runs one question on a fixture scenario and returns the raw reply. */
  chat: (scenario: string, market?: "US" | "SG" | "JP") => Promise<Response> | Response;
  /** `GET` with a Host the guard accepts, unless `headers` say otherwise. */
  get: (path: string, headers?: Record<string, string>) => Promise<Response> | Response;
}

/** The app as `src/server/main.ts` builds it in fixture mode: the real runtime, its scenario replayer and its image proxy. */
export function runtimeApp(): RuntimeApp {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const deps = createRuntime(parseConfig({ NODE_ENV: "test", KENSAKU_EXA_MODE: "fixture" }));
  const app = createApp(deps);
  const host = `127.0.0.1:${deps.config.port}`;
  return {
    deps,
    app,
    chat: (scenario, market = "US") =>
      app.request("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", host },
        body: JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: Q1 }] }], market, fixtureScenario: scenario }),
      }),
    get: (path, headers = {}) => app.request(path, { headers: { host, ...headers } }),
  };
}
