import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate, OfferSummary, SearchHit } from "../../src/core";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as T;
}

interface LiveResult {
  url: string;
  title?: string | null;
  summary?: string;
}
export interface LiveFixture {
  receivedAt: string;
  response: { requestId?: string; results?: LiveResult[]; citations?: { url: string }[]; answer?: unknown };
}
export interface ClassificationCase {
  id: string;
  fixture?: string;
  resultIndex?: number;
  synthetic?: { url: string; title: string | null; summary: OfferSummary; notInRunResults?: boolean };
  candidate: string;
  expected: {
    outcome: "merchant-offer" | "evidence" | "rejected";
    category?: string;
    currency?: string;
    amount?: number;
    canonicalUrl?: string;
    availability?: string;
  };
}
export interface ClassificationFile {
  candidates: Record<string, Candidate>;
  cases: ClassificationCase[];
}

export function loadLiveFixture(id: string): LiveFixture {
  return readJson<LiveFixture>(`evals/fixtures/exa-live/${id}.json`);
}

function parseSummary(raw: string | undefined): OfferSummary | null {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as OfferSummary;
  } catch {
    return null;
  }
}

/** Builds the classifier input for a case: the hit, its candidate, and this run's result URLs. */
export function buildClassificationInput(file: ClassificationFile, c: ClassificationCase) {
  const candidate = file.candidates[c.candidate];
  if (!candidate) throw new Error(`${c.id}: unknown candidate ${c.candidate}`);
  if (c.synthetic) {
    const { url, title, summary, notInRunResults } = c.synthetic;
    const hit: SearchHit = { url, title, summary, exaRequestId: "synthetic", retrievedAt: "2026-11-21T00:00:00.000Z" };
    return { hit, candidate, runResultUrls: new Set(notInRunResults ? [] : [url]) };
  }
  const fixture = loadLiveFixture(c.fixture!);
  const results = fixture.response.results ?? [];
  const result = results[c.resultIndex!];
  if (!result) throw new Error(`${c.id}: no result ${c.resultIndex} in ${c.fixture}`);
  const hit: SearchHit = {
    url: result.url,
    title: result.title ?? null,
    summary: parseSummary(result.summary),
    exaRequestId: fixture.response.requestId ?? "fixture",
    retrievedAt: fixture.receivedAt,
  };
  return { hit, candidate, runResultUrls: new Set(results.map((r) => r.url)) };
}
