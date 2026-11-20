import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RequestBudget } from "../../src/exa/budget";
import { FixtureExaPort, loadScenario, ScenarioSchema } from "../../src/exa/fixture-port";
import { fakeClock, storage } from "./helpers";

const scenariosDir = join(import.meta.dirname, "../fixtures/scenarios");
const root = join(import.meta.dirname, "../..");
const signal = new AbortController().signal;
const clock = fakeClock("2026-11-21T10:00:00Z");

describe("scenario files", () => {
  const names = readdirSync(scenariosDir).map((f) => f.replace(/\.json$/, ""));

  it("include the three baseline scenarios", () => {
    expect(names).toEqual(expect.arrayContaining(["xm5-us", "xm5-sg", "xm5-jp"]));
  });

  it.each(names)("%s is valid, labels synthetic steps, and references only existing frozen files", (name) => {
    const scenario = loadScenario(name);
    expect(ScenarioSchema.parse(JSON.parse(readFileSync(join(scenariosDir, `${name}.json`), "utf8")))).toEqual(scenario);
    for (const step of scenario.steps) {
      if (step.response?.candidates || step.error) expect(step.label).toMatch(/^SYNTHETIC/);
      if (step.response) {
        expect(step.response.ref).toMatch(/^evals\/fixtures\/exa-live\//);
        expect(existsSync(join(root, step.response.ref))).toBe(true);
      }
    }
  });

  it("rejects names and refs that escape their directories", () => {
    expect(() => loadScenario("../x")).toThrow();
  });
});

describe("FixtureExaPort baselines", () => {
  it.each([
    ["xm5-us", "US", "USD", 5],
    ["xm5-sg", "SG", "SGD", 5],
    ["xm5-jp", "JP", "JPY", 4],
  ] as const)("%s replays a candidate answer then the real search", async (name, market, currency, hits) => {
    const port = FixtureExaPort.load(name, { clock });
    const budget = new RequestBudget(5);
    const answer = await port.answerCandidates("Sony WH-1000XM5?", market, budget, signal);
    expect(answer.candidates).toEqual([expect.objectContaining({ brand: "Sony", modelIdentifiers: ["WH-1000XM5"] })]);
    expect(answer.citationUrls).toHaveLength(8);
    const search = await port.searchOffers(answer.candidates[0]!, market, budget, signal);
    expect(search.hits.length).toBeGreaterThanOrEqual(hits - 1);
    expect(search.hits.some((h) => h.summary?.currency === currency)).toBe(true);
    expect(port.calls).toBe(2);
    expect(budget.used).toBe(2);
  });

  it("raises the scripted failure for an error scenario", async () => {
    const port = FixtureExaPort.load("error-429", { clock });
    await expect(port.answerCandidates("q", "US", new RequestBudget(5), signal)).rejects.toMatchObject({
      kind: "rate_limited",
      retryAfterMs: 1000,
    });
  });

  it("slow-answer can be cancelled mid-wait", async () => {
    const port = FixtureExaPort.load("slow-answer", { clock });
    const ac = new AbortController();
    const pending = port.answerCandidates("q", "US", new RequestBudget(5), ac.signal);
    setTimeout(() => ac.abort(), 10);
    await expect(pending).rejects.toMatchObject({ kind: "timeout" });
  });

  it("fails loudly when called beyond the script or out of order", async () => {
    const port = FixtureExaPort.load("error-401", { clock });
    await expect(port.searchOffers({ name: "a", brand: "b", modelIdentifiers: [] }, "US", new RequestBudget(5), signal)).rejects.toThrow(/is answer, called search/);
  });

  it("honours an injected cache and ledger exactly like the live port", async () => {
    const s = storage(clock);
    const port = FixtureExaPort.load("xm5-us", { clock, cache: s.cache, ledger: s.ledger });
    const first = await port.answerCandidates("Q", "US", new RequestBudget(5), signal);
    const budget = new RequestBudget(5);
    const again = await port.answerCandidates("Q", "US", budget, signal);
    expect(again).toMatchObject({ cached: true, retrievedAt: first.retrievedAt, costDollars: 0 });
    expect(port.calls).toBe(1);
    expect(budget.used).toBe(0);
    expect(s.ledger.read()).toEqual({ requests: 1, costDollars: 0.005 });
  });
});
