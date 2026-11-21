import { describe, expect, it } from "vitest";
import { classifyHit, imageBytesVerdict, imageUrlVerdict, rankImageCandidates } from "../../src/core";
import type { Candidate, Market, OfferSummary, SearchHit } from "../../src/core";
import { loadLiveFixture, readJson, type ClassificationFile } from "../core/fixtures";

// Frozen gold cases: evals/cases/image-selection.json (read-only, every case evaluated).
interface SyntheticHit {
  url: string;
  title: string | null;
  image: string | null;
  summary: OfferSummary | null;
}
interface ImageFile {
  urlCases: { id: string; imageUrl: string; expected: string }[];
  selectionCases: {
    id: string;
    fixture?: string;
    synthetic?: { hits: SyntheticHit[] };
    candidate: string;
    market: Market;
    expected: { imageUrl: string; pageUrl: string }[];
  }[];
  bytesCases: { id: string; type: "jpeg" | "png" | "webp" | "avif" | "gif" | "unknown"; width: number; height: number; bytes: number; expected: string }[];
}
const file = readJson<ImageFile>("evals/cases/image-selection.json");
const mvp = readJson<ClassificationFile>("evals/cases/offer-classification.json");
const v11 = readJson<ClassificationFile>("evals/cases/offer-classification-v1-1.json");
const candidates: Record<string, Candidate> = { ...mvp.candidates, ...v11.candidates };

function hitsOf(c: ImageFile["selectionCases"][number]): SearchHit[] {
  if (c.synthetic) {
    return c.synthetic.hits.map((h) => ({ ...h, exaRequestId: "synthetic", retrievedAt: "2026-11-21T00:00:00.000Z" }));
  }
  const fixture = loadLiveFixture(c.fixture!);
  return (fixture.response.results ?? []).map((r) => {
    const raw = r as typeof r & { image?: string | null };
    return {
      url: r.url,
      title: r.title ?? null,
      summary: typeof r.summary === "string" ? (JSON.parse(r.summary) as OfferSummary) : null,
      image: raw.image ?? null,
      exaRequestId: fixture.response.requestId ?? "fixture",
      retrievedAt: fixture.receivedAt,
    };
  });
}

describe("EV-013 image selection", () => {
  it("evaluates every case in the frozen file", () => {
    expect(file.urlCases.length).toBe(80);
    expect(file.selectionCases.length).toBe(10);
    expect(file.bytesCases.length).toBe(58);
  });

  describe("I1 url eligibility", () => {
    it.each(file.urlCases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
      expect(imageUrlVerdict(c.imageUrl)).toBe(c.expected);
    });
  });

  describe("I2 selection", () => {
    it.each(file.selectionCases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
      const candidate = candidates[c.candidate];
      if (!candidate) throw new Error(`${c.id}: unknown candidate ${c.candidate}`);
      const hits = hitsOf(c);
      const runUrls = new Set(hits.map((h) => h.url));
      const classified = hits.map((hit) => ({ hit, result: classifyHit(hit, candidate, runUrls) }));
      const sources = rankImageCandidates(classified, candidate, c.market);
      expect(sources.map(({ imageUrl, pageUrl }) => ({ imageUrl, pageUrl }))).toEqual(c.expected);
    });
  });

  describe("I3 bytes verdict", () => {
    it.each(file.bytesCases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
      expect(imageBytesVerdict({ type: c.type, width: c.width, height: c.height }, c.bytes)).toBe(c.expected);
    });
  });
});
