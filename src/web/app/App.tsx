import { useState } from "react";
import type { Market } from "../../core/types";
import { Alert, AlertDescription, AlertTitle } from "@/web/components/ui/alert";
import { Button } from "@/web/components/ui/button";
import { Conversation, ConversationContent, ConversationEmptyState } from "@/web/components/ai-elements/conversation";
import { Message, MessageContent } from "@/web/components/ai-elements/message";
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/web/components/ai-elements/prompt-input";
import { Suggestion } from "@/web/components/ai-elements/suggestion";
import { CartSheet } from "./CartSheet";
import { CheckoutReturn } from "./CheckoutReturn";
import { ClearHistory, MarketSelect } from "./Controls";
import { Comparison } from "./Comparison";
import { Products } from "./Products";
import { ErrorNotice, Progress, UsageFooter } from "./RunStatus";
import { announcementOf, textOf } from "./messages";
import type { ClientRunState, RunView } from "./messages";
import { ThemeToggle } from "./ThemeToggle";
import { readCheckoutReturn } from "./commerce";
import { CartContext, useCartState } from "./useCart";
import { useResearchChat } from "./useResearchChat";

const SUGGESTIONS = [
  "Sony WH-1000XM5 headphones: where can I buy them and are they worth it?",
  "Best ergonomic wireless mouse for programming under $120",
];

function RunFooter({ view, state, fixture }: { view: RunView; state: ClientRunState; fixture: boolean }) {
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
      return view.usage ? <UsageFooter usage={view.usage} fixture={fixture} /> : null;
  }
}

function AssistantRun({ view, state, fixture, market }: { view: RunView; state: ClientRunState; fixture: boolean; market: Market | undefined }) {
  return (
    <div className="w-full min-w-0 max-w-full space-y-8">
      {(view.progress.length > 0 || state === "running") && <Progress progress={view.progress} />}
      {/* Above the results it qualifies: "the results below are partial". */}
      {view.error && <ErrorNotice error={view.error} />}
      {(view.text !== undefined || view.comparisonTruncated) && <Comparison text={view.text} truncated={view.comparisonTruncated} sources={view.sources} />}
      {view.products !== undefined && <Products products={view.products} market={market} />}
      <RunFooter view={view} state={state} fixture={fixture} />
    </div>
  );
}

const HISTORY_NOTICE = {
  unreadable: "The saved history could not be read, so it was reset.",
  newer: "The saved history was written by a newer version of Kensaku, so it was reset.",
} as const;

/** Read once when the page loads, then taken out of the address bar so a reload does not repeat the cancel or the poll. */
const INITIAL_CHECKOUT_RETURN = readCheckoutReturn(window.location.search);
if (INITIAL_CHECKOUT_RETURN) {
  const rest = new URLSearchParams(window.location.search);
  for (const name of ["checkout", "order", "session_id"]) rest.delete(name);
  window.history.replaceState(null, "", window.location.pathname + (rest.size > 0 ? `?${rest}` : "") + window.location.hash);
}

export function App() {
  const chat = useResearchChat();
  const { mode, ready, running, turns, ask } = chat;
  const cart = useCartState(mode === "fixture");
  const [checkoutReturn, setCheckoutReturn] = useState(INITIAL_CHECKOUT_RETURN);

  return (
    <CartContext.Provider value={cart}>
      <main className="mx-auto flex h-dvh max-w-6xl flex-col gap-3 p-3 sm:p-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Kensaku</h1>
            <p className="text-sm text-muted-foreground">Local shopping research: a cited comparison and merchant offers, with prices as last observed.</p>
          </div>
          <div className="flex items-center gap-2">
            <CartSheet />
            <ThemeToggle />
            <ClearHistory disabled={running || !chat.hasMessages} onConfirm={chat.clear} />
          </div>
        </header>
        {mode === "fixture" && (
          <Alert data-testid="fixture-banner">
            <AlertTitle>Fixture data</AlertTitle>
            <AlertDescription>Answers are replayed from recorded scenarios, not fetched from Exa.</AlertDescription>
          </Alert>
        )}
        {checkoutReturn && <CheckoutReturn params={checkoutReturn} onSettled={() => void cart.refresh()} onDismiss={() => setCheckoutReturn(undefined)} />}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="cart-announcer">
          {cart.announcement}
        </div>
        {chat.historyNotice && (
          <Alert data-testid="history-notice">
            <AlertTitle>History reset</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              {HISTORY_NOTICE[chat.historyNotice]}
              <Button type="button" variant="outline" size="sm" onClick={chat.dismissHistoryNotice}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer">
          {announcementOf(turns.at(-1))}
        </div>
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="px-2 sm:px-4">
            {turns.length === 0 ? (
              <ConversationEmptyState title="Ask a shopping question" description="Kensaku compares a few products and finds direct merchant offers.">
                <div className="space-y-3 text-center">
                  <h3 className="text-sm font-medium">Ask a shopping question</h3>
                  <p className="text-sm text-muted-foreground">Pick a market below, then type a question or try an example.</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <Suggestion key={s} suggestion={s} onClick={ask} disabled={!ready} className="h-auto max-w-full whitespace-normal rounded-xl py-1.5 text-left" />
                    ))}
                  </div>
                </div>
              </ConversationEmptyState>
            ) : (
              turns.map(({ question, market, view, state }) => (
                <div key={question.id} className="flex min-w-0 flex-col gap-8" data-testid="turn" data-state={state}>
                  <Message from="user">
                    <MessageContent>
                      <p>{textOf(question)}</p>
                    </MessageContent>
                  </Message>
                  <Message from="assistant" className="max-w-full">
                    <MessageContent className="w-full">
                      <AssistantRun view={view} state={state} fixture={mode === "fixture"} market={market} />
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
            <MarketSelect value={chat.market} onChange={chat.chooseMarket} disabled={running} />
          </div>
          {running && (
            <Button type="button" variant="outline" size="sm" onClick={() => void chat.stop()}>
              Cancel
            </Button>
          )}
        </div>
        <PromptInput onSubmit={({ text }) => ask(text)}>
          <PromptInputBody>
            <PromptInputTextarea placeholder="Ask about a product…" disabled={running || !ready} aria-label="Question" />
          </PromptInputBody>
          <PromptInputFooter>
            {/* The group dims everything inside it while the textarea is disabled, so nothing but the Send button lives here during a run. */}
            <span className="text-xs text-muted-foreground">{running ? "" : "Enter to send, Shift+Enter for a new line"}</span>
            <PromptInputSubmit status={chat.status} aria-label="Send" disabled={running || !ready} />
          </PromptInputFooter>
        </PromptInput>
      </main>
    </CartContext.Provider>
  );
}
