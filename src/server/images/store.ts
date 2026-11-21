import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CacheEntry } from "./cache";
import type { RegistryEntry } from "./types";

export const ID_PATTERN = /^[0-9a-f]{64}$/;

/**
 * `<id>.json` (the registry entry and its last verdict) and `<id>.bin` (accepted bytes) in one directory.
 * `index` mirrors what is on disk, built once at construction and updated by every write and delete,
 * so pruning and cache decisions never scan the directory.
 */
export class ImageStore {
  readonly index = new Map<string, CacheEntry>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    const ids = new Set<string>();
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".tmp")) rmSync(join(dir, name), { force: true }); // a crash mid-write leaves these
      const id = name.replace(/\.(json|bin)$/, "");
      if (ID_PATTERN.test(id)) ids.add(id);
    }
    for (const id of ids) {
      const entry = this.read(id);
      if (entry) this.index.set(id, { registeredAt: entry.registeredAt, ...(entry.verdict && { verdict: entry.verdict }), size: this.byteSize(id) });
      else this.delete(id);
    }
  }

  read(id: string): RegistryEntry | undefined {
    try {
      const entry = JSON.parse(readFileSync(join(this.dir, `${id}.json`), "utf8")) as RegistryEntry;
      return typeof entry.url === "string" && typeof entry.registeredAt === "number" ? entry : undefined;
    } catch {
      return undefined;
    }
  }

  write(id: string, entry: RegistryEntry): void {
    this.atomic(`${id}.json`, JSON.stringify(entry));
    this.index.set(id, { registeredAt: entry.registeredAt, ...(entry.verdict && { verdict: entry.verdict }), size: this.index.get(id)?.size ?? 0 });
  }

  readBytes(id: string): Uint8Array | undefined {
    try {
      return readFileSync(join(this.dir, `${id}.bin`));
    } catch {
      return undefined;
    }
  }

  writeBytes(id: string, bytes: Uint8Array): void {
    this.atomic(`${id}.bin`, bytes);
    const entry = this.index.get(id);
    if (entry) entry.size = bytes.length;
  }

  deleteBytes(id: string): void {
    rmSync(join(this.dir, `${id}.bin`), { force: true });
    const entry = this.index.get(id);
    if (entry) entry.size = 0;
  }

  delete(id: string): void {
    rmSync(join(this.dir, `${id}.json`), { force: true });
    this.deleteBytes(id);
    this.index.delete(id);
  }

  private byteSize(id: string): number {
    try {
      return statSync(join(this.dir, `${id}.bin`)).size;
    } catch {
      return 0;
    }
  }

  private atomic(name: string, data: string | Uint8Array): void {
    const target = join(this.dir, name);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, data);
    renameSync(temp, target);
  }
}
