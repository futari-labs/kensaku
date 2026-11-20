import type { MiddlewareHandler } from "hono";
import { VITE_DEV_PORT } from "./config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * DNS-rebinding and cross-site guard (ARCHITECTURE, "Operations"). A `Host` header that is not this
 * server's own address gets 403; so does a state-changing request whose `Origin` is present and not
 * this server's own origin. A request with no `Host` header at all can only come from a caller inside
 * this process (a browser always sends one, and Node refuses HTTP/1.1 requests without it).
 */
export function hostOriginGuard(options: { port: number; dev: boolean }): MiddlewareHandler {
  const ports = options.dev ? [options.port, VITE_DEV_PORT] : [options.port];
  const hosts = new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  return async (c, next) => {
    const host = c.req.header("host");
    const origin = c.req.header("origin");
    const hostOk = host === undefined || hosts.has(host.toLowerCase());
    const originOk = origin === undefined || SAFE_METHODS.has(c.req.method) || origins.has(origin.toLowerCase());
    if (!hostOk || !originOk) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}
