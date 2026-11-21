import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Market } from "../../core/types";
import { ApiErrorBodySchema } from "../../research/events";
import type { ExaMode } from "../../research/events";
import { turnsOf, withFailure } from "./messages";
import type { ChatMessage, FailureData } from "./messages";
import { HealthSchema } from "./schemas";
import { clearHistory, loadHistory, loadMarket, saveHistory, saveMarket } from "./storage";

/** Set by the e2e tests (`/?scenario=name`) and sent only when the server reports fixture mode. */
const SCENARIO = new URLSearchParams(window.location.search).get("scenario");

/** `"unknown"` only until `/api/health` answers; sending waits for it so a fixture scenario is never dropped. */
type Mode = ExaMode | "unknown";

function useServerMode(): Mode {
  const [mode, setMode] = useState<Mode>("unknown");
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((body) => setMode(HealthSchema.parse(body).mode))
      // A server that cannot say is treated as live: the chat request will surface its failure.
      .catch(() => setMode("live"));
  }, []);
  return mode;
}

/** The `{ kind, message }` body of a 4xx reply, or a generic upstream failure when the error is anything else. */
function failureOf(error: Error): Pick<FailureData, "kind" | "message"> {
  try {
    const body = ApiErrorBodySchema.safeParse(JSON.parse(error.message));
    if (body.success) return body.data;
  } catch {
    // not JSON
  }
  return { kind: "upstream", message: "The connection to Kensaku's server failed." };
}

/** Everything the page does with the chat: the request, its state, and what is saved in the browser. */
export function useResearchChat() {
  const mode = useServerMode();
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const [restored] = useState(loadHistory);
  const [historyNotice, setHistoryNotice] = useState(restored.notice);
  const [market, setMarket] = useState(loadMarket);
  const marketRef = useRef(market);
  marketRef.current = market;
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: "/api/chat",
        body: () => ({ market: marketRef.current, ...(modeRef.current === "fixture" && SCENARIO ? { fixtureScenario: SCENARIO } : {}) }),
      }),
    [],
  );
  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat<ChatMessage>({ transport, messages: restored.messages });
  const running = status === "submitted" || status === "streaming";

  // A failed request or broken stream becomes part of the conversation, so it is saved and restored like any other run.
  useEffect(() => {
    if (status === "error" && error) setMessages((current) => withFailure(current, failureOf(error)));
  }, [status, error, setMessages]);

  useEffect(() => {
    if (!running && messages.length > 0) saveHistory(messages);
  }, [messages, running]);

  const chooseMarket = useCallback((next: Market) => {
    setMarket(next);
    saveMarket(next);
  }, []);

  const clear = () => {
    setMessages([]);
    clearError();
    clearHistory();
  };

  const ready = mode !== "unknown";
  const ask = (text: string) => {
    if (running || !ready || text.trim() === "") return;
    void sendMessage({ text, metadata: { market: marketRef.current } });
  };

  return {
    mode,
    ready,
    running,
    status,
    stop,
    ask,
    clear,
    market,
    chooseMarket,
    historyNotice,
    dismissHistoryNotice: () => setHistoryNotice(undefined),
    hasMessages: messages.length > 0,
    turns: turnsOf(messages, { running, requestFailed: status === "error" }),
  };
}
