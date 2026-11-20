import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/web/components/ui/alert";
import { Button } from "@/web/components/ui/button";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/web/components/ai-elements/conversation";
import { Message, MessageContent } from "@/web/components/ai-elements/message";
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/web/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/web/components/ai-elements/suggestion";
import { Comparison } from "./Comparison";
import { Products } from "./Products";
import { ErrorNotice, Progress, UsageFooter } from "./RunStatus";
import { emptyView, runStateOf, textOf, viewOf } from "./messages";
import type { ClientRunState, RunView } from "./messages";
import type { Market } from "../../core/types";
import { ApiErrorBodySchema } from "../../research/events";
import type { ApiErrorKind, ExaMode, KensakuMessage } from "../../research/events";

/** The slice fixes the market; the selector arrives with JM-005. */
const MARKET: Market = "US";
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

/** The `{ kind, message }` body of a 4xx reply, or a generic upstream failure when the body is anything else. */
function httpErrorOf(error: Error): { kind: ApiErrorKind; partial: false } {
  try {
    const body = ApiErrorBodySchema.safeParse(JSON.parse(error.message));
    if (body.success) return { kind: body.data.kind, partial: false };
  } catch {
    // not JSON
  }
  return { kind: "upstream", partial: false };
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
    <div className="space-y-5">
      <Progress progress={view.progress} />
      {view.text !== undefined && <Comparison text={view.text} sources={view.sources} />}
      {view.products !== undefined && <Products products={view.products} />}
      {view.error && <ErrorNotice error={view.error} />}
      <RunFooter view={view} state={state} />
    </div>
  );
}

export function App() {
  const mode = useServerMode();
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const transport = useMemo(
    () =>
      new DefaultChatTransport<KensakuMessage>({
        api: "/api/chat",
        body: () => ({ market: MARKET, ...(modeRef.current === "fixture" && SCENARIO ? { fixtureScenario: SCENARIO } : {}) }),
      }),
    [],
  );
  const { messages, sendMessage, status, stop, error } = useChat<KensakuMessage>({ transport });
  // Keyed by the question's message id: the assistant message may not exist yet when the person cancels.
  const [cancelled, setCancelled] = useState<ReadonlySet<string>>(new Set());
  const running = status === "submitted" || status === "streaming";

  const cancel = () => {
    const question = messages.findLast((m) => m.role === "user");
    if (question) setCancelled((prev) => new Set(prev).add(question.id));
    void stop();
  };

  const lastQuestion = messages.findLast((m) => m.role === "user");
  const stateOf = (message: KensakuMessage, question: KensakuMessage | undefined): ClientRunState =>
    runStateOf(viewOf(message), {
      streaming: running && message === messages.at(-1),
      cancelled: question !== undefined && cancelled.has(question.id),
    });

  const ask = (text: string) => {
    if (running || text.trim() === "") return;
    void sendMessage({ text });
  };

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col gap-3 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Kensaku</h1>
        <p className="text-sm text-muted-foreground">Local shopping research: a cited comparison and merchant offers, with prices as last observed.</p>
      </header>
      {mode === "fixture" && (
        <Alert data-testid="fixture-banner">
          <AlertTitle>Fixture data</AlertTitle>
          <AlertDescription>Answers are replayed from recorded scenarios, not fetched from Exa.</AlertDescription>
        </Alert>
      )}
      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState title="Ask a shopping question" description="Kensaku compares a few products and finds direct merchant offers.">
              <div className="space-y-3 text-center">
                <h3 className="text-sm font-medium">Ask a shopping question</h3>
                <Suggestions>
                  {SUGGESTIONS.map((s) => (
                    <Suggestion key={s} suggestion={s} onClick={ask} />
                  ))}
                </Suggestions>
              </div>
            </ConversationEmptyState>
          ) : (
            <>
              {messages.map((message, index) => (
                <Message key={message.id} from={message.role}>
                  <MessageContent>
                    {message.role === "user" ? (
                      <p>{textOf(message)}</p>
                    ) : (
                      <AssistantRun view={viewOf(message)} state={stateOf(message, messages[index - 1])} />
                    )}
                  </MessageContent>
                </Message>
              ))}
              {lastQuestion && !running && messages.at(-1) === lastQuestion && cancelled.has(lastQuestion.id) && (
                <Message from="assistant">
                  <MessageContent>
                    <AssistantRun view={emptyView()} state="cancelled" />
                  </MessageContent>
                </Message>
              )}
            </>
          )}
          {error && !running && <ErrorNotice error={httpErrorOf(error)} />}
        </ConversationContent>
      </Conversation>
      <PromptInput onSubmit={({ text }) => ask(text)}>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Ask about a product…" disabled={running} aria-label="Question" />
        </PromptInputBody>
        <PromptInputFooter>
          <span className="text-xs text-muted-foreground">Market: United States</span>
          {running ? (
            <Button type="button" variant="outline" size="sm" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <PromptInputSubmit status={status} aria-label="Send" />
          )}
        </PromptInputFooter>
      </PromptInput>
    </main>
  );
}
