import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { DiskCache } from "../../src/exa/cache";
import { UsageLedger } from "../../src/exa/ledger";
import type { ExaClientLike } from "../../src/exa/sdk-port";

export const frozen = (id: string): { response: unknown } =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../evals/fixtures/exa-live", `${id}.json`), "utf8"));

/** A mutable fixed clock. */
export function fakeClock(start: string) {
  let t = Date.parse(start);
  const clock = () => new Date(t);
  return Object.assign(clock, { advance: (ms: number) => void (t += ms) });
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
export const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), "kensaku-exa-"));
  dirs.push(d);
  return d;
};

export function storage(clock: () => Date, limits: { requestLimit?: number; costLimit?: number } = {}) {
  const root = tempDir();
  const ledger = new UsageLedger({ dir: join(root, "ledger"), ...limits });
  return {
    root,
    cache: new DiskCache({ dir: join(root, "exa") }),
    ledger,
    /** The ledger's current month at the test clock. */
    usage: () => ledger.read(clock()),
  };
}

/** Fake SDK client. Each call pops the next reply (a value, or an Error to throw); `calls` records them. */
export function fakeClient(replies: unknown[]) {
  const calls: { method: "answer" | "search"; query: string; options: Record<string, unknown>; call: unknown }[] = [];
  const next = (method: "answer" | "search", query: string, options: Record<string, unknown>, call: unknown) => {
    calls.push({ method, query, options, call });
    const reply = replies.shift();
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  };
  const client: ExaClientLike = {
    answer: (q, o, c) => next("answer", q, o, c),
    search: (q, o, c) => next("search", q, o, c),
  };
  return { client, calls };
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message = "request failed",
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ExaError";
  }
}
