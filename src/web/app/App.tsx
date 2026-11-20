import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/web/components/ui/alert";
import { Button } from "@/web/components/ui/button";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/web/components/ai-elements/conversation";
import { Message, MessageContent } from "@/web/components/ai-elements/message";
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/web/components/ai-elements/prompt-input";
import { Suggestion } from "@/web/components/ai-elements/suggestion";
import { ClearHistory, MarketSelect } from "./Controls";
import { Comparison } from "./Comparison";
import { Products } from "./Products";
import { ErrorNotice, Progress, UsageFooter } from "./RunStatus";
import { announcementOf, emptyView, textOf, turnsOf, viewOf, withFailure } from "./messages";
import type { ClientRunState, FailureData, KensakuMessage, RunView } from "./messages";
import { clearHistory, loadHistory, loadMarket, saveHistory, saveMarket } from "./storage";
import { ApiErrorBodySchema } from "../../research/events";
import type { ExaMode } from "../../research/events";

const SUGGESTIONS = [
  "Sony WH-1000XM5 headphones: where can I buy them and are they worth it?",
  "Best ergonomic wireless mouse for programming under $120",
];

/** Set by the e2e tests (`/?scenario=name`) and sent only when the server reports fixture mode. */
const SCENARIO = new URLSearchParams(window.location.search).get("scenario");

type Mode = ExaMode | "unknown";

function useServerMode(): Mode {
  const [mode, setMode] = useState<Mode>("unknown");
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<{ mode?: string }>)
      .then((health) => setMode(health.mode === "fixture" ? "fixture" : "live"))
      .catch(() => setMode("unknown"));
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

function RunFooter({ view, state }: { view: RunView; state: ClientRunState }) {
  switch (state) {
    case "running":
      return null;
    case "cancelled":
      return (
        <Alert data-testid="run-cancelled">
          <AlertTitle>Run cancelled</AlertTitle>
          <AlertDescription>{view.products || view.text ? "Results received before cancelling are shown above." : "No results were received."}</AlertDescription>
        </Alert>
      );
    case "completed":
    case "failed":
      return view.usage ? <UsageFooter usage={view.usage} /> : null;
  }
}

function AssistantRun({ view, state }: { view: RunView; state: ClientRunState }) {
  return (
    <div className="min-w-0 max-w-full space-y-5">
      {(view.progress.length > 0 || state === "running") && <Progress progress={view.progress} />}
      {view.text !== undefined && <Comparison text={view.text} sources={view.sources} />}
      {view.products !== undefined && <Products products={view.products} />}
      {view.error && <ErrorNotice error={view.error} />}
      <RunFooter view={view} state={state} />
    </div>
  );
}

const HISTORY_NOTICE = {
  unreadable: "The saved history could not be read, so it was reset.",
  newer: "The saved history was written by a newer version of Kensaku, so it was reset.",
} as const;

export function App() {
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
      new DefaultChatTransport<KensakuMessage>({
        api: "/api/chat",
        body: () => ({ market: marketRef.current, ...(modeRef.current === "fixture" && SCENARIO ? { fixtureScenario: SCENARIO } : {}) }),
      }),
    [],
  );
  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat<KensakuMessage>({ transport, messages: restored.messages });
  const running = status === "submitted" || status === "streaming";

  // A failed request or broken stream becomes part of the conversation, so it is saved and restored like any other run.
  useEffect(() => {
    if (status === "error" && error) setMessages((current) => withFailure(current, failureOf(error)));
  }, [status, error, setMessages]);

  useEffect(() => {
    if (!running && messages.length > 0) saveHistory(messages);
  }, [messages, running]);

  const chooseMarket = useCallback((next: typeof market) => {
    setMarket(next);
    saveMarket(next);
  }, []);

  const clear = () => {
    setMessages([]);
    clearError();
    clearHistory();
  };

  const ask = (text: string) => {
    if (running || text.trim() === "") return;
    void sendMessage({ text });
  };

  const turns = turnsOf(messages, running);

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col gap-3 p-3 sm:p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Kensaku</h1>
          <p className="text-sm text-muted-foreground">Local shopping research: a cited comparison and merchant offers, with prices as last observed.</p>
        </div>
        <ClearHistory disabled={running || messages.length === 0} onConfirm={clear} />
      </header>
      {mode === "fixture" && (
        <Alert data-testid="fixture-banner">
          <AlertTitle>Fixture data</AlertTitle>
          <AlertDescription>Answers are replayed from recorded scenarios, not fetched from Exa.</AlertDescription>
        </Alert>
      )}
      {historyNotice && (
        <Alert data-testid="history-notice">
          <AlertTitle>History reset</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            {HISTORY_NOTICE[historyNotice]}
            <Button type="button" variant="outline" size="sm" onClick={() => setHistoryNotice(undefined)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer">
        {announcementOf(turns.at(-1))}
      </div>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
          {turns.length === 0 ? (
            <ConversationEmptyState title="Ask a shopping question" description="Kensaku compares a few products and finds direct merchant offers.">
              <div className="space-y-3 text-center">
                <h3 className="text-sm font-medium">Ask a shopping question</h3>
                <p className="text-sm text-muted-foreground">Pick a market below, then type a question or try an example.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <Suggestion key={s} suggestion={s} onClick={ask} className="h-auto max-w-full whitespace-normal rounded-xl py-1.5 text-left" />
                  ))}
                </div>
              </div>
            </ConversationEmptyState>
          ) : (
            turns.map(({ question, answer, state }) => (
              <div key={question.id} className="flex min-w-0 flex-col gap-8" data-testid="turn" data-state={state}>
                <Message from="user">
                  <MessageContent>
                    <p>{textOf(question)}</p>
                  </MessageContent>
                </Message>
                <Message from="assistant">
                  <MessageContent>
                    <AssistantRun view={answer ? viewOf(answer) : emptyView()} state={state} />
                  </MessageContent>
                </Message>
              </div>
            ))
          )}
        </ConversationContent>
      </Conversation>
      {/* Outside the prompt's form: Radix Select resets itself to its first value when the form it sits in is reset on submit. */}
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground" aria-hidden="true">
            Market
          </span>
          <MarketSelect value={market} onChange={chooseMarket} disabled={running} />
        </div>
        {running && (
          <Button type="button" variant="outline" size="sm" onClick={() => void stop()}>
            Cancel
          </Button>
        )}
      </div>
      <PromptInput onSubmit={({ text }) => ask(text)}>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Ask about a product…" disabled={running} aria-label="Question" />
        </PromptInputBody>
        <PromptInputFooter>
          {/* The group dims everything inside it while the textarea is disabled, so nothing but the Send button lives here during a run. */}
          <span className="text-xs text-muted-foreground">{running ? "" : "Enter to send, Shift+Enter for a new line"}</span>
          <PromptInputSubmit status={status} aria-label="Send" disabled={running} />
        </PromptInputFooter>
      </PromptInput>
    </main>
  );
}
