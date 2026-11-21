import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DiskCache } from "../exa/cache";
import { systemClock } from "../exa/clock";
import { ExaFailure } from "../exa/errors";
import { FixtureExaPort } from "../exa/fixture-port";
import type { PortOptions } from "../exa/guarded-port";
import { UsageLedger } from "../exa/ledger";
import type { ExaPort } from "../exa/port";
import { ExaSdkPort } from "../exa/sdk-port";
import type { AppDeps, LogLine } from "./app";
import { appConfigOf } from "./config";
import { FixtureImageFetch, ImageProxy, NetworkImageFetch } from "./images";
import type { ServerConfig } from "./config";

export const DEFAULT_FIXTURE_SCENARIO = "xm5-us";
const FIXTURE_IMAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/images");

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

/** Appends each Exa exchange to a JSON-lines file. The exchange holds no key and no header. */
function exchangeRecorder(path: string): NonNullable<PortOptions["onExchange"]> {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  return (exchange) => appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), ...exchange })}\n`);
}

/**
 * Builds the app's real dependencies from a parsed config. Live: the SDK port over `.cache/`, with
 * the monthly ledger. Fixture: a scenario replayer per run with no cache and no ledger writes, so a
 * fixture run never touches `.cache/`, never serves another scenario's cached answer, and a scripted
 * 402 cannot block the next scenario (the ledger shown by `/api/usage` is a throwaway one).
 */
export function createRuntime(config: ServerConfig): AppDeps {
  const clock = systemClock;
  const log = stdoutLogger(config.exaApiKey);
  const storage = config.mode === "fixture" ? mkdtempSync(join(tmpdir(), "kensaku-fixture-")) : resolve(".cache");
  const ledger = new UsageLedger({ dir: join(storage, "ledger"), ...config.limits });
  const onWarning = (note: string) => log({ event: "warning", note });

  const imageDir = join(storage, "images");

  if (config.mode === "fixture") {
    // Each scenario run adds the fixture file its image URLs map to; earlier scenarios' mappings stay.
    const fetcher = new FixtureImageFetch(FIXTURE_IMAGE_DIR);
    return {
      config: appConfigOf(config),
      ledger,
      clock,
      log,
      images: new ImageProxy({ port: fetcher, clock, log, dir: imageDir }),
      portFor: (scenario) => {
        const exa = FixtureExaPort.load(scenario ?? DEFAULT_FIXTURE_SCENARIO, { clock, answerMarketMode: config.answerMarketMode, onWarning });
        fetcher.add(exa.scenario.images);
        return exa;
      },
    };
  }

  const port: ExaPort = config.exaApiKey
    ? ExaSdkPort.fromApiKey(config.exaApiKey, {
        ledger,
        clock,
        cache: new DiskCache({ dir: join(storage, "exa") }),
        answerMarketMode: config.answerMarketMode,
        onWarning,
        ...(config.exchangeLog && { onExchange: exchangeRecorder(config.exchangeLog) }),
      })
    : unconfiguredPort;
  const images = new ImageProxy({ port: new NetworkImageFetch(), clock, log, dir: imageDir });
  return { config: appConfigOf(config), ledger, clock, log, images, portFor: () => port };
}
