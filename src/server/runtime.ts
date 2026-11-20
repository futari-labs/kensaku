import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DiskCache } from "../exa/cache";
import { systemClock } from "../exa/clock";
import { ExaFailure } from "../exa/errors";
import { FixtureExaPort } from "../exa/fixture-port";
import { UsageLedger } from "../exa/ledger";
import type { ExaPort } from "../exa/port";
import { ExaSdkPort } from "../exa/sdk-port";
import type { AppDeps, LogLine } from "./app";
import { appConfigOf } from "./config";
import type { ServerConfig } from "./config";

export const DEFAULT_FIXTURE_SCENARIO = "xm5-us";

const unconfiguredPort: ExaPort = {
  answerCandidates: () => Promise.reject(new ExaFailure("auth", "EXA_API_KEY is not set; add it to .env.local or EXA_ENV_FILE.")),
  searchOffers: () => Promise.reject(new ExaFailure("auth", "EXA_API_KEY is not set; add it to .env.local or EXA_ENV_FILE.")),
};

/** One JSON line to stdout. The key, if known, is scrubbed from the line as a last defence. */
function stdoutLogger(secret: string | undefined): (line: LogLine) => void {
  return (line) => {
    const text = JSON.stringify({ ts: new Date().toISOString(), ...line });
    console.log(secret ? text.replaceAll(secret, "[redacted]") : text);
  };
}

/**
 * Builds the app's real dependencies from a parsed config. Live: the SDK port over `.cache/`, with
 * the monthly ledger. Fixture: a scenario replayer per run, over a throwaway ledger and no cache, so a
 * fixture run never touches `.cache/` and never serves another scenario's cached answer.
 */
export function createRuntime(config: ServerConfig): AppDeps {
  const clock = systemClock;
  const log = stdoutLogger(config.exaApiKey);
  const storage = config.mode === "fixture" ? mkdtempSync(join(tmpdir(), "kensaku-fixture-")) : resolve(".cache");
  const ledger = new UsageLedger({ dir: join(storage, "ledger"), ...config.limits });
  const onWarning = (note: string) => log({ event: "warning", note });

  if (config.mode === "fixture") {
    return {
      config: appConfigOf(config),
      ledger,
      clock,
      log,
      portFor: (scenario) => FixtureExaPort.load(scenario ?? DEFAULT_FIXTURE_SCENARIO, { ledger, clock, answerMarketMode: config.answerMarketMode, onWarning }),
    };
  }

  const port: ExaPort = config.exaApiKey
    ? ExaSdkPort.fromApiKey(config.exaApiKey, {
        ledger,
        clock,
        cache: new DiskCache({ dir: join(storage, "exa") }),
        answerMarketMode: config.answerMarketMode,
        onWarning,
      })
    : unconfiguredPort;
  return { config: appConfigOf(config), ledger, clock, log, portFor: () => port };
}
