import type { UIMessage } from "ai";
import { MARKET_CURRENCY } from "../../core/currency";
import type { Currency, Market } from "../../core/types";
import { MARKETS } from "./markets";
import { STAGES } from "../../research/events";
import type { ApiErrorKind, ErrorData, KensakuDataParts, ProductResult, ProgressData, RunState, SourceRef, Stage, UsageData } from "../../research/events";

/** What the web app shows for a failed run: a run's own error kinds plus the 4xx kinds of `POST /api/chat`, which it records itself. */
export type FailureData = Omit<ErrorData, "kind"> & { kind: ApiErrorKind };
/** The market a question was asked in; its card keeps saying that market after the selection changes. */
export interface MessageMetadata {
  market?: Market;
}
export type ChatMessage = UIMessage<MessageMetadata, Omit<KensakuDataParts, "error"> & { error: FailureData }>;

export interface RunView {
  progress: ProgressData[];
  text: string | undefined;
  /** Exa's comparison ended in leaked structure that was cut or dropped (D-042); the note belongs beside it. */
  comparisonTruncated: boolean;
  sources: SourceRef[];
  products: ProductResult[] | undefined;
  usage: UsageData | undefined;
  error: FailureData | undefined;
}

/** Collects what an assistant message's parts say about its run. */
export function viewOf(message: Pick<ChatMessage, "parts"> | undefined): RunView {
  const view: RunView = { progress: [], text: undefined, comparisonTruncated: false, sources: [], products: undefined, usage: undefined, error: undefined };
  for (const part of message?.parts ?? []) {
    switch (part.type) {
      case "data-progress":
        view.progress.push(part.data);
        break;
      case "data-products":
        view.products = part.data;
        break;
      case "data-comparison":
        view.comparisonTruncated = part.data.truncated;
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

/** The view of a question that has no answer yet. */
export const emptyView = (): RunView => viewOf(undefined);

/**
 * `cancelled` is an explicit user cancel and wins over everything else; `requestFailed` means the
 * request itself failed (HTTP error or broken stream) before or without an error part.
 */
export function runStateOf(
  view: RunView,
  now: { streaming: boolean; requestFailed?: boolean; cancelled?: boolean },
): ClientRunState {
  if (now.cancelled) return "cancelled";
  if (now.streaming) return "running";
  if (view.error || now.requestFailed) return "failed";
  if (view.usage) return "completed";
  // Cancelled = a finished run with no closing part: every completed run ends with usage and every failed one with an error.
  return "cancelled";
}

/**
 * The market a turn was for: the question's metadata, else (history from before v1.1) the market whose currency leads most
 * offer lists in the run (a tie goes to the first product's). `rankOffers` (src/core/rank.ts) puts the market's currency first in
 * every product's groups, so each product that has offers votes for it. Undefined when the run has no offers, where no card needs it.
 */
function marketOf(question: ChatMessage, products: ProductResult[] | undefined): Market | undefined {
  if (question.metadata?.market) return question.metadata.market;
  const leading = (products ?? []).flatMap((p) => (p.offerGroups[0] ? [p.offerGroups[0].currency] : []));
  const votes = (c: Currency) => leading.filter((l) => l === c).length;
  // The strict `>` keeps the earlier currency on a tie, and `leading` is in product order.
  const currency = leading.reduce<Currency | undefined>((best, c) => (best === undefined || votes(c) > votes(best) ? c : best), undefined);
  return MARKETS.find((m) => MARKET_CURRENCY[m] === currency);
}

/** One question and the run that answers it; a question cancelled before the reply began has an empty view. */
export interface Turn {
  question: ChatMessage;
  /** See `marketOf`. */
  market: Market | undefined;
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
    return { question, market: marketOf(question, view.products), view, state: runStateOf(view, { streaming: newest && now.running, requestFailed: newest && now.requestFailed }) };
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
