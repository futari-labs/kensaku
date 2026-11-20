import type { UIMessage } from "ai";
import type { ProductResult, RunErrorKind, RunUsage, Stage } from "../../research/events";

export interface ProgressData {
  stage: Stage;
  status: "running" | "done" | "failed";
  detail?: string;
}

export interface UsageData extends RunUsage {
  monthRequests: number;
  monthLimit: number;
}

export interface ErrorData {
  kind: RunErrorKind;
  message: string;
  partial: boolean;
}

/** The `data-*` parts `POST /api/chat` streams (ARCHITECTURE, "Interfaces and data"). */
export type KensakuDataParts = {
  progress: ProgressData;
  products: ProductResult[];
  usage: UsageData;
  error: ErrorData;
};

export type KensakuMessage = UIMessage<unknown, KensakuDataParts>;
export type KensakuPart = KensakuMessage["parts"][number];

export interface RunView {
  progress: ProgressData[];
  text: string | undefined;
  sources: { sourceId: string; url: string }[];
  products: ProductResult[] | undefined;
  usage: UsageData | undefined;
  error: ErrorData | undefined;
}

/** Collects what an assistant message's parts say about its run. */
export function viewOf(message: KensakuMessage): RunView {
  const view: RunView = { progress: [], text: undefined, sources: [], products: undefined, usage: undefined, error: undefined };
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

export const textOf = (message: KensakuMessage): string =>
  message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
