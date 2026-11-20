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
import { textOf, viewOf } from "./messages";
import type { KensakuMessage } from "./messages";

/** The slice fixes the market; the selector arrives with JM-005. */
const MARKET = "US";
const SUGGESTIONS = [
  "Sony WH-1000XM5 headphones: where can I buy them and are they worth it?",
  "Best ergonomic wireless mouse for programming under $120",
];

type Mode = "live" | "fixture" | "unknown";

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

/** `{ kind, message }` JSON from a 4xx reply, or a generic failure. */
function httpErrorOf(error: Error): { kind: string; partial: false } {
  try {
    const body = JSON.parse(error.message) as { kind?: unknown };
    if (typeof body.kind === "string") return { kind: body.kind, partial: false };
  } catch {
    // not a Kensaku error body
  }
  return { kind: "upstream", partial: false };
}

function AssistantRun({ message, cancelled, running }: { message: KensakuMessage; cancelled: boolean; running: boolean }) {
  const view = viewOf(message);
  return (
    <div className="space-y-5">
      <Progress progress={view.progress} />
      {view.text !== undefined && <Comparison text={view.text} sources={view.sources} />}
      {view.products !== undefined && <Products products={view.products} />}
      {view.error && <ErrorNotice error={view.error} />}
      {cancelled && (
        <Alert data-testid="run-cancelled">
          <AlertTitle>Run cancelled</AlertTitle>
          <AlertDescription>{view.products || view.text ? "Results received before cancelling are shown above." : "No results were received."}</AlertDescription>
        </Alert>
      )}
      {view.usage && !running && <UsageFooter usage={view.usage} />}
    </div>
  );
}

export function App() {
  const mode = useServerMode();
  const scenario = useRef(new URLSearchParams(window.location.search).get("scenario"));
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const transport = useMemo(
    () =>
      new DefaultChatTransport<KensakuMessage>({
        api: "/api/chat",
        body: () => ({ market: MARKET, ...(modeRef.current === "fixture" && scenario.current ? { fixtureScenario: scenario.current } : {}) }),
      }),
    [],
  );
  const { messages, sendMessage, status, stop, error } = useChat<KensakuMessage>({ transport });
  const [cancelled, setCancelled] = useState<ReadonlySet<string>>(new Set());
  const running = status === "submitted" || status === "streaming";

  const cancel = () => {
    const last = messages.at(-1);
    if (last?.role === "assistant") setCancelled((prev) => new Set(prev).add(last.id));
    void stop();
  };

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
            messages.map((message, index) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.role === "user" ? (
                    <p>{textOf(message)}</p>
                  ) : (
                    <AssistantRun message={message} cancelled={cancelled.has(message.id)} running={running && index === messages.length - 1} />
                  )}
                </MessageContent>
              </Message>
            ))
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
