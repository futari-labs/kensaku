import type { MiddlewareHandler } from "hono";
import { VITE_DEV_PORT } from "./config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * DNS-rebinding and cross-site guard (ARCHITECTURE, "Operations"). A `Host` header that is not this
 * server's own address gets 403; so does a state-changing request whose `Origin` is present and not
 * this server's own origin; so does a request that arrived over a socket with no `Host` header
 * (HTTP/1.0 allows that). Only an in-process call (`app.request`) has no socket and no `Host`.
 */
export function hostOriginGuard(options: { port: number; dev: boolean }): MiddlewareHandler {
  const ports = options.dev ? [options.port, VITE_DEV_PORT] : [options.port];
  const hosts = new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  return async (c, next) => {
    const host = c.req.header("host");
    const origin = c.req.header("origin");
    const overSocket = (c.env as { incoming?: unknown } | undefined)?.incoming !== undefined;
    const hostOk = host === undefined ? !overSocket : hosts.has(host.toLowerCase());
    const originOk = origin === undefined || SAFE_METHODS.has(c.req.method) || origins.has(origin.toLowerCase());
    if (!hostOk || !originOk) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}
