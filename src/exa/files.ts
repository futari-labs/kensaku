import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Write JSON through a temporary file in the same directory, then rename it into place. */
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}
