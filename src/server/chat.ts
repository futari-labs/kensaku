import type { UIMessageChunk } from "ai";
import { z } from "zod";
import type { RunEvent } from "../research/events";

const MAX_QUESTION_CHARS = 2_000;

const ChatBodySchema = z.object({
  messages: z.array(z.looseObject({ role: z.string(), parts: z.array(z.looseObject({ type: z.string() })).default([]) })).min(1),
  market: z.enum(["US", "SG", "JP"]),
  fixtureScenario: z.string().regex(/^[a-z0-9-]+$/).max(64).optional(),
});

export interface ChatRequest {
  question: string;
  market: "US" | "SG" | "JP";
  fixtureScenario: string | undefined;
}

export type ParsedChat = { ok: true; request: ChatRequest } | { ok: false; message: string };

/** The request boundary: `{ messages, market }` from useChat. Only the last user message's text is researched. */
export function parseChatBody(raw: unknown, mode: "live" | "fixture"): ParsedChat {
  const body = ChatBodySchema.safeParse(raw);
  if (!body.success) return { ok: false, message: "Expected { messages, market } with market US, SG, or JP." };
  const { messages, market, fixtureScenario } = body.data;
  if (fixtureScenario !== undefined && mode !== "fixture") return { ok: false, message: "fixtureScenario is accepted only in fixture mode." };
  const lastUser = messages.findLast((m) => m.role === "user");
  const question = (lastUser?.parts ?? [])
    .flatMap((p) => (p.type === "text" && typeof p.text === "string" ? [p.text] : []))
    .join("\n")
    .trim();
  if (question === "") return { ok: false, message: "The last user message has no text." };
  if (question.length > MAX_QUESTION_CHARS) return { ok: false, message: `The question is longer than ${MAX_QUESTION_CHARS} characters.` };
  return { ok: true, request: { question, market, fixtureScenario } };
}

export interface MonthUsage {
  monthRequests: number;
  monthLimit: number;
}

/** One run event as UI message stream parts (ARCHITECTURE, `POST /api/chat`). A cancelled run writes nothing. */
export function toChunks(event: RunEvent, month: () => MonthUsage): UIMessageChunk[] {
  switch (event.type) {
    case "progress": {
      const data = { stage: event.stage, status: event.status, ...(event.detail !== undefined && { detail: event.detail }) };
      return [{ type: "data-progress", id: event.stage, data }];
    }
    case "comparison":
      return [
        { type: "text-start", id: "comparison" },
        { type: "text-delta", id: "comparison", delta: event.text },
        { type: "text-end", id: "comparison" },
        ...event.sources.map((s): UIMessageChunk => ({ type: "source-url", sourceId: s.sourceId, url: s.url })),
      ];
    case "products":
      return [{ type: "data-products", id: "products", data: event.products }];
    case "usage":
      return [{ type: "data-usage", id: "usage", data: { ...event.usage, ...month() } }];
    case "error":
      return [{ type: "data-error", id: "error", data: { kind: event.kind, message: event.message, partial: event.partial } }];
    case "end":
      return event.state === "cancelled" ? [] : [{ type: "finish" }];
  }
}
