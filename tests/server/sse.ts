import type { UIMessageChunk } from "ai";
import type { KensakuDataParts } from "../../src/research/events";

/** A chunk of `POST /api/chat`'s stream, typed by the same contract `toChunks` is checked against. */
export type Chunk = UIMessageChunk<unknown, KensakuDataParts>;

export function parseSse(text: string): Chunk[] {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: ") && block !== "data: [DONE]")
    .map((block) => JSON.parse(block.slice("data: ".length)) as Chunk);
}

export async function readChunks(res: Response): Promise<Chunk[]> {
  return parseSse(await res.text());
}

export const ofType = <T extends Chunk["type"]>(chunks: Chunk[], type: T): Extract<Chunk, { type: T }>[] =>
  chunks.filter((c): c is Extract<Chunk, { type: T }> => c.type === type);
