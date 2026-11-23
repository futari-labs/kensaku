import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { FetchResult, ImageFetchPort } from "./types";

/** Fixture-mode fetch: serves files from `dir` for the URLs a fixture scenario maps; anything else is an upstream 404. Mapped values are bare file names. */
export class FixtureImageFetch implements ImageFetchPort {
  private readonly files = new Map<string, string>();

  constructor(
    private readonly dir: string,
    initial: Readonly<Record<string, string>> = {},
  ) {
    this.add(initial);
  }

  /** Maps more image URLs to files. A URL mapped before is remapped; all of `images` is checked before any is added. */
  add(images: Readonly<Record<string, string>>): void {
    const entries = Object.entries(images);
    for (const [, file] of entries) if (basename(file) !== file || file === "" || file === "." || file === "..") throw new Error(`Fixture image "${file}" must be a file name, not a path.`);
    for (const [url, file] of entries) this.files.set(url, file);
  }

  fetch(url: string): Promise<FetchResult> {
    const file = this.files.get(url);
    if (file === undefined) return Promise.resolve({ ok: false, reason: "upstream-status" });
    try {
      return Promise.resolve({ ok: true, bytes: readFileSync(join(this.dir, file)) });
    } catch {
      return Promise.resolve({ ok: false, reason: "network-error" });
    }
  }
}
