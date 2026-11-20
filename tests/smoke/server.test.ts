import { describe, expect, it } from "vitest";
import { app } from "../../src/server/index";

describe("server scaffold", () => {
  it("GET /api/health reports ok without secrets", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(Object.keys(body).sort()).toEqual(["exaConfigured", "mode", "ok"]);
  });
});
