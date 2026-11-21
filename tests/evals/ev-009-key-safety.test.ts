// EV-009 Local and key safety: a real server process, a production build, and every place the key could leak.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Q1 } from "../fixtures/questions";
import { spawnServer } from "../server/process";
import type { ServerProcess } from "../server/process";

const ROOT = join(import.meta.dirname, "../..");
const KEY = `sk-test-ev009-${Math.random().toString(36).slice(2)}${Date.now()}`;
const CHAT = JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: Q1 }] }], market: "US", fixtureScenario: "xm5-us" });

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

interface Reply {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function request(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: options.headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d: string) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** ARCHITECTURE, "Content-Security-Policy (v1.1)", written out here so a change to the server's constant fails this test. */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

/** What the fixture server wrote under its temp directory (tsx keeps its own socket files there, which are not ours to read). */
const serverFiles = (tmp: string) =>
  readdirSync(tmp)
    .filter((name) => name.startsWith("kensaku-fixture-"))
    .flatMap((name) => filesUnder(join(tmp, name)));

const holdsKey = (path: string) => readFileSync(path).includes(KEY);

describe("EV-009 running server", () => {
  let server: ServerProcess;
  let port = 0;
  const responses: string[] = [];
  // The fixture server keeps its image registry and bytes under the temp directory, so give it one this test can scan.
  const serverTmp = mkdtempSync(join(tmpdir(), "kensaku-ev009-tmp-"));

  beforeAll(async () => {
    port = await freePort();
    server = await spawnServer({ ...process.env, NODE_ENV: "test", KENSAKU_EXA_MODE: "fixture", KENSAKU_PORT: String(port), EXA_API_KEY: KEY, TMPDIR: serverTmp });
  }, 30_000);

  afterAll(() => {
    server?.stop();
    rmSync(serverTmp, { recursive: true, force: true });
  });

  const own = () => ({ host: `127.0.0.1:${port}` });

  it("listens on 127.0.0.1 only", async () => {
    expect(server.lines.find((l) => l.event === "listening")).toMatchObject({ host: "127.0.0.1", port });
    const external = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i!.address);
    for (const address of external) {
      const outcome = await new Promise<string>((resolve) => {
        const socket = net.connect({ host: address, port, timeout: 1_500 });
        socket.on("connect", () => (socket.destroy(), resolve("connected")));
        socket.on("timeout", () => (socket.destroy(), resolve("refused")));
        socket.on("error", () => resolve("refused"));
      });
      expect(outcome, `reachable on ${address}`).toBe("refused");
    }
  });

  it("refuses a foreign Host or Origin with 403 and accepts its own", async () => {
    const health = await request(port, { path: "/api/health", headers: own() });
    expect(health.status).toBe(200);
    responses.push(health.body);

    expect((await request(port, { path: "/api/health", headers: { host: `evil.example:${port}` } })).status).toBe(403);
    expect((await request(port, { path: "/api/health", headers: { host: "127.0.0.1:1" } })).status).toBe(403);

    const post = (origin: string | undefined) =>
      request(port, { method: "POST", path: "/api/chat", headers: { ...own(), "content-type": "application/json", ...(origin && { origin }) }, body: CHAT });
    expect((await post("http://evil.example")).status).toBe(403);
    expect((await post(`http://evil.example:${port}`)).status).toBe(403);
    expect((await post("null")).status).toBe(403);
    const ok = await post(`http://127.0.0.1:${port}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('"type":"finish"');
    responses.push(ok.body);
    responses.push((await request(port, { path: "/api/usage", headers: own() })).body);
  });

  it("sends exactly the ARCHITECTURE Content-Security-Policy on the page and on API replies", async () => {
    for (const path of ["/", "/api/health"]) expect((await request(port, { path, headers: own() })).headers["content-security-policy"], path).toBe(CSP);
  });

  it("serves images for a run, refuses a foreign Host with 403, and leaves no key in the image cache", async () => {
    const chat = JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: Q1 }] }], market: "SG", fixtureScenario: "xm5-sg-cards" });
    const run = await request(port, { method: "POST", path: "/api/chat", headers: { ...own(), "content-type": "application/json", origin: `http://127.0.0.1:${port}` }, body: chat });
    expect(run.status).toBe(200);
    responses.push(run.body);
    const ids = [...new Set([...run.body.matchAll(/"id":"([0-9a-f]{64})"/g)].map((m) => m[1]!))];
    expect(ids.length).toBe(6);

    const loaded: Reply[] = [];
    for (const id of ids) loaded.push(await request(port, { path: `/api/image/${id}`, headers: { ...own(), "sec-fetch-site": "same-origin" } }));
    expect(loaded.filter((r) => r.status === 200).length).toBe(4);
    for (const r of loaded) {
      expect(r.headers["content-security-policy"]).toBe("default-src 'none'");
      responses.push(r.body);
    }

    const foreign = await request(port, { path: `/api/image/${ids[1]}`, headers: { host: `evil.example:${port}`, "sec-fetch-site": "same-origin" } });
    expect(foreign.status).toBe(403);
    expect(foreign.headers["content-security-policy"]).toBe("default-src 'none'");

    const cached = serverFiles(serverTmp).filter((f) => f.includes(`${sep}images${sep}`));
    expect(cached.some((f) => f.endsWith(".bin"))).toBe(true);
    for (const file of cached) expect(holdsKey(file), file).toBe(false);
  });

  it("keeps the key out of API responses, server logs, .cache/, and evals/fixtures/", () => {
    const output = server.output();
    expect(responses.length).toBeGreaterThanOrEqual(3);
    for (const body of responses) expect(body).not.toContain(KEY);
    expect(output).toContain('"event":"run_start"');
    expect(output).not.toContain(KEY);
    for (const file of [...filesUnder(join(ROOT, ".cache")), ...serverFiles(serverTmp), ...filesUnder(join(ROOT, "evals/fixtures"))]) {
      expect(holdsKey(file), file).toBe(false);
    }
  });
});

describe("EV-009 production build", () => {
  it("does not contain the key", () => {
    const out = mkdtempSync(join(tmpdir(), "kensaku-build-"));
    try {
      const build = spawnSync(join(ROOT, "node_modules/.bin/vite"), ["build", "--outDir", out, "--emptyOutDir"], {
        cwd: ROOT,
        env: { ...process.env, EXA_API_KEY: KEY, VITE_EXA_API_KEY: "", NODE_ENV: "production" },
        encoding: "utf8",
      });
      expect(build.status, build.stderr).toBe(0);
      const files = filesUnder(out);
      expect(files.length).toBeGreaterThan(1);
      for (const file of files) expect(holdsKey(file), file).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
