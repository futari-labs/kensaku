import type { ErrorData, KensakuMessage, ProductResult, ProgressData, SourceRef, UsageData } from "../../research/events";

export interface RunView {
  progress: ProgressData[];
  text: string | undefined;
  sources: SourceRef[];
  products: ProductResult[] | undefined;
  usage: UsageData | undefined;
  error: ErrorData | undefined;
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

export const textOf = (message: KensakuMessage): string =>
  message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
