import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { FetchResult, ImageFetchPort } from "./types";

/** Fixture-mode fetch: serves files from `dir` for the URLs a fixture scenario maps; anything else is an upstream 404. Mapped values are bare file names. */
export class FixtureImageFetch implements ImageFetchPort {
  constructor(
    private readonly files: Readonly<Record<string, string>>,
    private readonly dir: string,
  ) {
    for (const file of Object.values(files)) if (basename(file) !== file || file === "" || file === "." || file === "..") throw new Error(`Fixture image "${file}" must be a file name, not a path.`);
  }

  fetch(url: string): Promise<FetchResult> {
    const file = Object.hasOwn(this.files, url) ? this.files[url] : undefined;
    if (file === undefined) return Promise.resolve({ ok: false, reason: "upstream-status" });
    try {
      return Promise.resolve({ ok: true, bytes: readFileSync(join(this.dir, file)) });
    } catch {
      return Promise.resolve({ ok: false, reason: "network-error" });
    }
  }
}
