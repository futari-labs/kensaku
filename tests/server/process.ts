import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

export interface ServerProcess {
  child: ChildProcess;
  /** Everything the server wrote to stdout and stderr so far. */
  output(): string;
  /** The stdout lines so far, parsed as JSON; a line that is not JSON becomes `{ raw }`. */
  lines: Record<string, unknown>[];
  stop(): void;
}

/** Starts `src/server/main.ts` with exactly `env` and resolves once it logs its `listening` line. */
export async function spawnServer(env: NodeJS.ProcessEnv, startupMs = 20_000): Promise<ServerProcess> {
  const child = spawn(join(ROOT, "node_modules/.bin/tsx"), ["src/server/main.ts"], { cwd: ROOT, env });
  let output = "";
  let partial = "";
  const lines: Record<string, unknown>[] = [];
  child.stdout!.on("data", (d: Buffer) => {
    output += d.toString();
    const complete = (partial + d.toString()).split("\n");
    partial = complete.pop() ?? "";
    for (const line of complete) {
      try {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        lines.push({ raw: line.slice(0, 300) });
      }
    }
  });
  child.stderr!.on("data", (d: Buffer) => (output += d.toString()));
  const server: ServerProcess = { child, output: () => output, lines, stop: () => void child.kill() };

  const started = Date.now();
  while (!lines.some((l) => l.event === "listening")) {
    if (Date.now() - started > startupMs) {
      server.stop();
      throw new Error(`server did not start:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return server;
}
