// EV-017 Request contract: the requests Kensaku sends, against the requests frozen from the v1.1 spike.
import { describe, expect, it } from "vitest";
import type { Candidate, Market } from "../../src/core/types";
import { buildAnswerRequest, buildSearchRequest, cacheKey } from "../../src/exa/requests";
import { readJson } from "../core/fixtures";

interface FrozenRequest {
  request: { endpoint: string; body: Record<string, unknown> & { query: string; userLocation?: string; outputSchema?: unknown } };
}
const frozen = (id: string) => readJson<FrozenRequest>(`evals/fixtures/exa-live/${id}.json`).request.body;

const V9 = frozen("V9-answer-us-tight-identifiers");
const V2 = frozen("V2-search-sg-xm5");
const V3 = frozen("V3-search-sg-bambino");

/** The frozen query is `<brand> <name> price <market name> buy`, so the candidate is its first word and the rest. */
function candidateOf(query: string, marketName: string): Candidate {
  const [brand, ...rest] = query.replace(` price ${marketName} buy`, "").split(" ");
  return { brand: brand!, name: rest.join(" "), modelIdentifiers: [] };
}

describe("EV-017 request contract", () => {
  it("the /answer outputSchema deep-equals V9's frozen request", () => {
    expect(buildAnswerRequest("any question", "US", "userLocation").outputSchema).toEqual(V9.outputSchema);
    expect(buildAnswerRequest("any question", "SG", "question-text").outputSchema).toEqual(V9.outputSchema);
  });

  it("the /answer request keeps the MVP's other fields", () => {
    expect(buildAnswerRequest(V9.query, "US", "userLocation")).toEqual({ query: V9.query, text: false, outputSchema: V9.outputSchema, userLocation: "US" });
  });

  it.each([
    ["V2", V2, "Singapore", "SG"],
    ["V3", V3, "Singapore", "SG"],
  ] as const)("the offer request for %s's candidate equals the frozen query and userLocation, with the MVP contents", (_id, body, marketName, market) => {
    const request = buildSearchRequest(candidateOf(body.query, marketName), market);
    expect(request.query).toBe(body.query);
    expect(request.options.userLocation).toBe(body.userLocation);
    expect({ query: request.query, ...request.options }).toEqual(body);
  });

  it.each([
    ["US", "United States"],
    ["JP", "Japan"],
  ] as const)("a %s candidate searches '<brand> <name> price %s buy'", (market: Market, marketName) => {
    const candidate: Candidate = { brand: "Sony", name: "WH-1000XM5", modelIdentifiers: ["WH-1000XM5"] };
    const request = buildSearchRequest(candidate, market);
    expect(request.query).toBe(`Sony WH-1000XM5 price ${marketName} buy`);
    expect(request.options.userLocation).toBe(market);
  });

  it("the cache key differs from the key of the MVP query for the same candidate", () => {
    const candidate: Candidate = { brand: "Sony", name: "WH-1000XM5", modelIdentifiers: ["WH-1000XM5"] };
    for (const market of ["US", "SG", "JP"] as const) {
      const request = buildSearchRequest(candidate, market);
      const mvp = { ...request, query: "Sony WH-1000XM5 buy" };
      expect(cacheKey("/search", request, market)).not.toBe(cacheKey("/search", mvp, market));
    }
  });
});
