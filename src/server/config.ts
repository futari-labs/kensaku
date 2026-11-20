import { existsSync } from "node:fs";
import { z } from "zod";
import type { ExaMode } from "../research/events";
import { limitsFromEnv } from "../exa/ledger";
import type { Limits } from "../exa/ledger";
import type { AnswerMarketMode } from "../exa/requests";

/** The listen address is not configurable: Kensaku never leaves the machine (D-010). */
export const LISTEN_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
/** Port of Vite's dev server, allowed as a Host and Origin under `KENSAKU_DEV=1`. */
export const VITE_DEV_PORT = 5173;

export class ConfigError extends Error {}

export interface ServerConfig {
  mode: ExaMode;
  dev: boolean;
  port: number;
  answerMarketMode: AnswerMarketMode;
  /** Present only in live mode. It goes to the SDK constructor and nowhere else. */
  exaApiKey: string | undefined;
  limits: Limits;
  /** File that receives each Exa request and raw response as JSON lines (live smoke only). */
  exchangeLog: string | undefined;
}

/** What the app needs to know about its own configuration. Never carries the key. */
export interface AppConfig {
  mode: ExaMode;
  dev: boolean;
  port: number;
  exaConfigured: boolean;
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(blank, z.string().optional()),
  KENSAKU_EXA_MODE: z.preprocess(blank, z.enum(["live", "fixture"]).default("live")),
  KENSAKU_DEV: z.preprocess(blank, z.string().optional()),
  KENSAKU_PORT: z.preprocess(blank, z.coerce.number().int().min(1024).max(65535).default(DEFAULT_PORT)),
  KENSAKU_ANSWER_MARKET_MODE: z.preprocess(blank, z.enum(["userLocation", "question-text"]).default("userLocation")),
  EXA_API_KEY: z.preprocess(blank, z.string().optional()),
  KENSAKU_EXCHANGE_LOG: z.preprocess(blank, z.string().optional()),
});

/** Parses the environment once, at the boundary. Fixture mode is refused outside `NODE_ENV=test`. */
export function parseConfig(env: Record<string, string | undefined>): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const e = parsed.data;
  if (e.KENSAKU_EXA_MODE === "fixture" && e.NODE_ENV !== "test") {
    throw new ConfigError("KENSAKU_EXA_MODE=fixture is accepted only with NODE_ENV=test.");
  }
  return {
    mode: e.KENSAKU_EXA_MODE,
    dev: e.KENSAKU_DEV === "1",
    port: e.KENSAKU_PORT,
    answerMarketMode: e.KENSAKU_ANSWER_MARKET_MODE,
    exaApiKey: e.KENSAKU_EXA_MODE === "live" ? e.EXA_API_KEY : undefined,
    limits: limitsFromEnv(env),
    exchangeLog: e.KENSAKU_EXCHANGE_LOG,
  };
}

export const appConfigOf = (config: ServerConfig): AppConfig => ({
  mode: config.mode,
  dev: config.dev,
  port: config.port,
  exaConfigured: config.exaApiKey !== undefined,
});

/**
 * Loads `EXA_ENV_FILE`, or `.env.local` when it exists, into `process.env` (existing variables win).
 * Live mode only: fixture mode never reads a key file.
 */
export function loadKeyFile(env: Record<string, string | undefined> = process.env): void {
  const explicit = env.EXA_ENV_FILE?.trim();
  const path = explicit || ".env.local";
  if (!existsSync(path)) {
    if (explicit) throw new ConfigError(`EXA_ENV_FILE points to ${path}, which does not exist.`);
    return;
  }
  process.loadEnvFile(path);
}
