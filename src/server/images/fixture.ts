import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { FetchResult, ImageFetchPort } from "./types";

export const FIXTURE_IMAGE_DIR = join(import.meta.dirname, "../../../tests/fixtures/images");

/** Fixture-mode fetch: serves files from `tests/fixtures/images/` for the URLs a fixture scenario maps; anything else is an upstream 404. */
export class FixtureImageFetch implements ImageFetchPort {
  constructor(
    private readonly files: Readonly<Record<string, string>>,
    private readonly dir: string = FIXTURE_IMAGE_DIR,
  ) {}

  fetch(url: string): Promise<FetchResult> {
    const file = Object.hasOwn(this.files, url) ? this.files[url] : undefined;
    if (file === undefined) return Promise.resolve({ ok: false, reason: "upstream-status" });
    try {
      return Promise.resolve({ ok: true, bytes: readFileSync(join(this.dir, basename(file))) });
    } catch {
      return Promise.resolve({ ok: false, reason: "network-error" });
    }
  }
}
