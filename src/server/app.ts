import { randomUUID } from "node:crypto";
import { serveStatic } from "@hono/node-server/serve-static";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Clock } from "../exa/clock";
import type { ExaPort } from "../exa/port";
import type { UsageLedger } from "../exa/ledger";
import type { ApiErrorKind, KensakuMessage, RunEvent } from "../research/events";
import { runResearch } from "../research/pipeline";
import type { RunOptions } from "../research/pipeline";
import { parseChatBody, toChunks } from "./chat";
import type { AppConfig } from "./config";
import { hostOriginGuard } from "./guard";
import { SECURITY_HEADERS } from "./images";
import type { ImageProxy } from "./images";

export type LogLine = Record<string, unknown>;

export interface AppDeps {
  config: AppConfig;
  /** The port for one run. `scenario` is set only in fixture mode; an unknown scenario throws. */
  portFor(scenario: string | undefined): ExaPort;
  ledger: UsageLedger;
  clock: Clock;
  log: (line: LogLine) => void;
  /** Pipeline knobs (timeouts, backoff); tests shorten them. */
  run?: Pick<RunOptions, "sleep" | "callTimeoutMs" | "runTimeoutMs">;
  /** The image proxy behind `GET /api/image/:id`; without one the route does not exist. */
  images?: ImageProxy;
}

const jsonError = (kind: ApiErrorKind, message: string) => ({ kind, message });

/** The Hono app. Everything it touches arrives through `deps`; it holds one run lock and nothing else. */
export function createApp(deps: AppDeps): Hono {
  const { config, ledger, clock, log } = deps;
  const app = new Hono();
  let running = false;

  // Outermost, and set after next(), so the guard's 403 and the catch-all 404 on image paths carry the security headers too.
  const imageHeaders: MiddlewareHandler = async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
  };
  app.use("/api/image", imageHeaders);
  app.use("/api/image/*", imageHeaders);
  app.use("*", hostOriginGuard({ port: config.port, dev: config.dev }));

  app.get("/api/health", (c) => c.json({ ok: true, exaConfigured: config.exaConfigured, mode: config.mode }));

  app.get("/api/usage", (c) => {
    const month = ledger.read(clock());
    return c.json({ ...month, requestLimit: ledger.limits.requestLimit, costLimit: ledger.limits.costLimit });
  });

  app.post("/api/chat", async (c) => {
    const parsed = parseChatBody(await c.req.json().catch(() => undefined), config.mode);
    if (!parsed.ok) return c.json(jsonError("invalid_request", parsed.message), 400);
    const { question, market, fixtureScenario } = parsed.request;

    let port: ExaPort;
    try {
      port = deps.portFor(fixtureScenario);
    } catch {
      return c.json(jsonError("invalid_request", "Unknown fixture scenario."), 400);
    }
    if (running) return c.json(jsonError("run_in_progress", "A research run is already in progress"), 409);
    running = true;

    const signal = c.req.raw.signal;
    const runId = randomUUID();
    const month = () => ({ monthRequests: ledger.read(clock()).requests, monthLimit: ledger.limits.requestLimit });
    const stream = createUIMessageStream<KensakuMessage>({
      execute: async ({ writer }) => {
        try {
          writer.write({ type: "start", messageId: runId });
          for await (const event of runResearch({ question, market }, port, signal, { ...deps.run, runId, log })) {
            if (signal.aborted) break;
            for (const chunk of toChunks(event, month)) writer.write(chunk);
          }
        } catch (error) {
          log({ event: "run_crashed", runId, error: error instanceof Error ? error.name : "unknown" });
          if (!signal.aborted) {
            const crash: RunEvent[] = [
              { type: "error", kind: "upstream", message: "Unexpected server error.", partial: false },
              { type: "end", state: "failed" },
            ];
            for (const event of crash) for (const chunk of toChunks(event, month)) writer.write(chunk);
          }
        } finally {
          running = false;
        }
      },
      onError: () => "Unexpected server error.",
    });
    return createUIMessageStreamResponse({ stream });
  });

  const { images } = deps;
  if (images) app.get("/api/image/:id", (c) => images.serve(c.req.param("id"), c.req.header("sec-fetch-site")));

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("/*", serveStatic({ path: "./dist/index.html" }));

  return app;
}
