import type { UIMessage } from "ai";
import { STAGES } from "../../research/events";
import type { ApiErrorKind, ErrorData, KensakuDataParts, ProductResult, ProgressData, RunState, SourceRef, Stage, UsageData } from "../../research/events";

/** What the web app shows for a failed run: a run's own error kinds plus the 4xx kinds of `POST /api/chat`, which it records itself. */
export type FailureData = Omit<ErrorData, "kind"> & { kind: ApiErrorKind };
export type ChatMessage = UIMessage<unknown, Omit<KensakuDataParts, "error"> & { error: FailureData }>;

export interface RunView {
  progress: ProgressData[];
  text: string | undefined;
  sources: SourceRef[];
  products: ProductResult[] | undefined;
  usage: UsageData | undefined;
  error: FailureData | undefined;
}

/** Collects what an assistant message's parts say about its run. */
export function viewOf(message: ChatMessage | undefined): RunView {
  const view: RunView = { progress: [], text: undefined, sources: [], products: undefined, usage: undefined, error: undefined };
  for (const part of message?.parts ?? []) {
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

export type ClientRunState = RunState | "running";

/**
 * Where a run stands for the person watching. A failed request (HTTP 4xx, broken connection) is failed
 * from the moment `useChat` reports it, before its error part is stored in the message.
 */
export function runStateOf(view: RunView, now: { streaming: boolean; requestFailed: boolean }): ClientRunState {
  if (now.streaming) return "running";
  if (view.error || now.requestFailed) return "failed";
  if (view.usage) return "completed";
  // Cancelled = a finished run with no closing part: every completed run ends with usage and every failed one with an error.
  return "cancelled";
}

/** One question and the run that answers it; a question cancelled before the reply began has an empty view. */
export interface Turn {
  question: ChatMessage;
  view: RunView;
  state: ClientRunState;
}

/** Pairs each question with its answer; only the newest turn can still be running or have a failed request. */
export function turnsOf(messages: ChatMessage[], now: { running: boolean; requestFailed: boolean }): Turn[] {
  const pairs: { question: ChatMessage; answer: ChatMessage | undefined }[] = [];
  for (const message of messages) {
    if (message.role === "user") pairs.push({ question: message, answer: undefined });
    else if (message.role === "assistant") {
      const open = pairs.at(-1);
      if (open && open.answer === undefined) open.answer = message;
    }
  }
  return pairs.map(({ question, answer }, i) => {
    const newest = i === pairs.length - 1;
    const view = viewOf(answer);
    return { question, view, state: runStateOf(view, { streaming: newest && now.running, requestFailed: newest && now.requestFailed }) };
  });
}

/** Records a request or stream failure in the conversation so it is shown, saved, and restored like any run's error. */
export function withFailure(messages: ChatMessage[], failure: Pick<FailureData, "kind" | "message">): ChatMessage[] {
  const last = messages.at(-1);
  if (!last) return messages;
  if (last.role === "user") return [...messages, { id: `failure-${last.id}`, role: "assistant", parts: [{ type: "data-error", data: { ...failure, partial: false } }] }];
  const view = viewOf(last);
  if (view.error || view.usage) return messages;
  const partial = view.products !== undefined || view.text !== undefined;
  return [...messages.slice(0, -1), { ...last, parts: [...last.parts, { type: "data-error", data: { ...failure, partial } }] }];
}

export const textOf = (message: ChatMessage): string =>
  message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");

export const STAGE_LABEL: Record<Stage, string> = {
  candidates: "Finding candidates",
  offers: "Gathering offers",
  validate: "Validating offers",
  compare: "Writing the comparison",
};

/** The sentence a screen reader hears for the newest run; it changes as the stage does. */
export function announcementOf(turn: Turn | undefined): string {
  if (!turn) return "";
  switch (turn.state) {
    case "running": {
      const latest = turn.view.progress.at(-1);
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
