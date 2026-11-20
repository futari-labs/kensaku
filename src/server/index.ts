import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const HOST = "127.0.0.1";
const PORT = 8787;

export const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    exaConfigured: Boolean(process.env.EXA_API_KEY),
    mode: process.env.KENSAKU_EXA_MODE === "fixture" ? "fixture" : "live",
  }),
);

app.use("/*", serveStatic({ root: "./dist" }));
app.get("/*", serveStatic({ path: "./dist/index.html" }));

if (import.meta.filename === process.argv[1]) {
  if (!existsSync("dist/index.html")) {
    console.warn("dist/ is missing; run `pnpm build` to serve the web app.");
  }
  serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
    console.log(JSON.stringify({ event: "listening", host: info.address, port: info.port }));
  });
}
