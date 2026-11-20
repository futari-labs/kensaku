import type { UIMessage } from "ai";
import { STAGES } from "../../research/events";
import type { ApiErrorKind, ErrorData, KensakuDataParts, ProductResult, ProgressData, SourceRef, UsageData } from "../../research/events";

/** What the web app shows for a failed run: a run's own error kinds plus the 4xx kinds of `POST /api/chat`, which it records itself. */
export type FailureData = Omit<ErrorData, "kind"> & { kind: ApiErrorKind };
export type KensakuMessage = UIMessage<unknown, Omit<KensakuDataParts, "error"> & { error: FailureData }>;

export interface RunView {
  progress: ProgressData[];
  text: string | undefined;
  sources: SourceRef[];
  products: ProductResult[] | undefined;
  usage: UsageData | undefined;
  error: FailureData | undefined;
}

export const emptyView = (): RunView => ({ progress: [], text: undefined, sources: [], products: undefined, usage: undefined, error: undefined });

/** Collects what an assistant message's parts say about its run. */
export function viewOf(message: KensakuMessage): RunView {
  const view = emptyView();
  for (const part of message.parts) {
    switch (part.type) {
      case "data-progress":
        view.progress.push(part.data);
        break;
      case "data-products":
        view.products = part.data;
        break;
      case "data-usage":
        view.usage = part.data;
        break;
      case "data-error":
        view.error = part.data;
        break;
      case "text":
        view.text = part.text;
        break;
      case "source-url":
        view.sources.push({ sourceId: part.sourceId, url: part.url });
        break;
    }
  }
  return view;
}

export type ClientRunState = "running" | "completed" | "failed" | "cancelled";

/**
 * Where a run stands for the person watching. A cancel wins over everything the stream said, and it
 * counts even when no assistant message exists yet (cancelled while the request was still `submitted`).
 */
export function runStateOf(view: RunView, now: { streaming: boolean; cancelled: boolean }): ClientRunState {
  if (now.cancelled) return "cancelled";
  if (now.streaming) return "running";
  return view.error ? "failed" : "completed";
}

/** One question and the run that answers it. A question with no answer (cancelled before the reply began) has none. */
export interface Turn {
  question: KensakuMessage;
  answer: KensakuMessage | undefined;
  state: ClientRunState;
}

/** Pairs each question with its answer; only the newest turn can still be running. */
export function turnsOf(messages: KensakuMessage[], running: boolean): Turn[] {
  const turns: { question: KensakuMessage; answer: KensakuMessage | undefined }[] = [];
  for (const message of messages) {
    if (message.role === "user") turns.push({ question: message, answer: undefined });
    else if (message.role === "assistant") {
      const open = turns.at(-1);
      if (open && open.answer === undefined) open.answer = message;
    }
  }
  return turns.map((turn, i) => {
    const streaming = running && i === turns.length - 1;
    const view = turn.answer ? viewOf(turn.answer) : emptyView();
    // Every completed or failed run ends with a usage or error part, so a finished run with neither was cut short by Cancel.
    const cancelled = !streaming && !view.error && !view.usage;
    return { ...turn, state: runStateOf(view, { streaming, cancelled }) };
  });
}

/** Records a request or stream failure in the conversation so it is shown, saved, and restored like any run's error. */
export function withFailure(messages: KensakuMessage[], failure: Pick<FailureData, "kind" | "message">): KensakuMessage[] {
  const last = messages.at(-1);
  const partial = last?.role === "assistant";
  const part = { type: "data-error" as const, data: { ...failure, partial } };
  if (!last) return messages;
  if (last.role === "user") return [...messages, { id: `failure-${last.id}`, role: "assistant", parts: [part] }];
  if (viewOf(last).error || viewOf(last).usage) return messages;
  return [...messages.slice(0, -1), { ...last, parts: [...last.parts, part] }];
}

export const textOf = (message: KensakuMessage): string =>
  message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");

const STAGE_LABEL = {
  candidates: "Finding candidates",
  offers: "Gathering offers",
  validate: "Validating offers",
  compare: "Writing the comparison",
} as const;

/** The sentence a screen reader hears for the newest run; it changes as the stage does. */
export function announcementOf(turn: Turn | undefined): string {
  if (!turn) return "";
  const view = turn.answer ? viewOf(turn.answer) : emptyView();
  switch (turn.state) {
    case "running": {
      const latest = view.progress.at(-1);
      if (!latest) return "Research started.";
      // Between one stage ending and the next beginning, the next stage is the one being announced.
      const next = latest.status === "running" ? latest.stage : (STAGES[STAGES.indexOf(latest.stage) + 1] ?? latest.stage);
      return `${STAGE_LABEL[next]}.`;
    }
    case "completed":
      return "Research complete.";
    case "failed":
      return "The run failed.";
    case "cancelled":
      return "Run cancelled.";
  }
}

export { STAGE_LABEL };
