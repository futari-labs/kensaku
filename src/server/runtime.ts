import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeHostedRoutes } from "../commerce/fake-hosted";
import { FakeCheckoutPort } from "../commerce/fake-port";
import { OfferStore } from "../commerce/registry";
import { CommerceService } from "../commerce/service";
import { CommerceStore } from "../commerce/store";
import { StripeCheckoutPort } from "../commerce/stripe-port";
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
import type { CommerceDeps } from "./commerce-routes";
import { FixtureImageFetch, ImageProxy, NetworkImageFetch } from "./images";
import type { ServerConfig } from "./config";

export interface RuntimeOptions {
  cache?: string;
  commerce?: string;
  fakeCheckoutPort?: FakeCheckoutPort;
}

const FIXTURE_OBSERVED_AT = "2026-11-23T00:00:00.000Z";

export const DEFAULT_FIXTURE_SCENARIO = "xm5-us";
const FIXTURE_IMAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/images");

const unconfiguredPort: ExaPort = {
  answerCandidates: () => Promise.reject(new ExaFailure("auth", "EXA_API_KEY is not set; add it to .env.local or EXA_ENV_FILE.")),
  searchOffers: () => Promise.reject(new ExaFailure("auth", "EXA_API_KEY is not set; add it to .env.local or EXA_ENV_FILE.")),
};

function stdoutLogger(secrets: readonly (string | undefined)[]): (line: LogLine) => void {
  const known = secrets.filter((s): s is string => s !== undefined && s !== "");
  return (line) => {
    const text = JSON.stringify({ ts: new Date().toISOString(), ...line });
    console.log(known.reduce((out, secret) => out.replaceAll(secret, "[redacted]"), text));
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
export function createRuntime(config: ServerConfig, options?: RuntimeOptions): AppDeps {
  const clock = systemClock;
  const log = stdoutLogger([config.exaApiKey, config.stripe?.secretKey, config.stripe?.webhookSecret]);
  const fixtureRoot = config.mode === "fixture" ? mkdtempSync(join(tmpdir(), "kensaku-fixture-")) : undefined;
  const storage = options?.cache ?? fixtureRoot ?? resolve(".cache");
  const ledger = new UsageLedger({ dir: join(storage, "ledger"), ...config.limits });
  const commerceStore = new CommerceStore(options?.commerce ?? (fixtureRoot ? join(fixtureRoot, "commerce") : resolve(".data/commerce")));
  const offers = new OfferStore({ dir: join(storage, "offers"), clock });
  const onWarning = (note: string) => log({ event: "warning", note });

  const imageDir = join(storage, "images");

  if (config.mode === "fixture") {
    const webhookSecret = config.stripe?.webhookSecret ?? `whsec_${randomBytes(24).toString("hex")}`;
    const service = new CommerceService({ store: commerceStore, offers, port: options?.fakeCheckoutPort ?? new FakeCheckoutPort(config.port), clock, log, serverPort: config.port });
    const commerce: CommerceDeps = { service, webhookSecret, fakeHosted: fakeHostedRoutes({ service, secret: webhookSecret, clock }) };
    // Each scenario run adds the fixture file its image URLs map to; earlier scenarios' mappings stay.
    const fetcher = new FixtureImageFetch(FIXTURE_IMAGE_DIR);
    return {
      config: appConfigOf(config),
      ledger,
      clock,
      log,
      images: new ImageProxy({ port: fetcher, clock, log, dir: imageDir }),
      commerce,
      portFor: (scenario) => {
        const exa = FixtureExaPort.load(scenario ?? DEFAULT_FIXTURE_SCENARIO, { clock: () => new Date(FIXTURE_OBSERVED_AT), answerMarketMode: config.answerMarketMode, onWarning });
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
  const service = new CommerceService({
    store: commerceStore,
    offers,
    port: config.stripe && StripeCheckoutPort.fromSecretKey(config.stripe.secretKey),
    clock,
    log,
    serverPort: config.port,
  });
  return { config: appConfigOf(config), ledger, clock, log, images, commerce: { service, webhookSecret: config.stripe?.webhookSecret }, portFor: () => port };
}
