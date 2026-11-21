import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RegistryEntry } from "./types";

export const ID_PATTERN = /^[0-9a-f]{64}$/;

/** `<id>.json` (the registry entry and its last verdict) and `<id>.bin` (accepted bytes) in one directory. */
export class ImageStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  ids(): string[] {
    const ids = new Set<string>();
    for (const name of readdirSync(this.dir)) {
      const id = name.replace(/\.(json|bin)$/, "");
      if (ID_PATTERN.test(id)) ids.add(id);
    }
    return [...ids];
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
  }

  byteSize(id: string): number {
    try {
      return statSync(join(this.dir, `${id}.bin`)).size;
    } catch {
      return 0;
    }
  }

  deleteBytes(id: string): void {
    rmSync(join(this.dir, `${id}.bin`), { force: true });
  }

  delete(id: string): void {
    rmSync(join(this.dir, `${id}.json`), { force: true });
    this.deleteBytes(id);
  }

  private atomic(name: string, data: string | Uint8Array): void {
    const target = join(this.dir, name);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, data);
    renameSync(temp, target);
  }
}
