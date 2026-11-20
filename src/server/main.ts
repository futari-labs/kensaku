import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { ConfigError, LISTEN_HOST, loadKeyFile, parseConfig } from "./config";
import { createRuntime } from "./runtime";

try {
  if (process.env.KENSAKU_EXA_MODE !== "fixture") loadKeyFile();
  const config = parseConfig(process.env);
  if (!existsSync("dist/index.html")) console.warn("dist/ is missing; run `pnpm build` to serve the web app.");
  const app = createApp(createRuntime(config));
  serve({ fetch: app.fetch, hostname: LISTEN_HOST, port: config.port }, (info) => {
    console.log(JSON.stringify({ event: "listening", host: info.address, port: info.port, mode: config.mode }));
  });
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
