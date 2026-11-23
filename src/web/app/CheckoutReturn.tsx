import { useEffect, useState } from "react";
import { ORDER_BADGE_LABELS, paidLabel } from "../../core/commerce";
import { Alert, AlertDescription, AlertTitle } from "@/web/components/ui/alert";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { cancelOrder, fetchOrder } from "./commerce";
import type { CheckoutReturn as Params, OrderView } from "./commerce";

const FAST_POLL_MS = 1_000;
const SLOW_POLL_MS = 5_000;
const HINT_AFTER_MS = 20_000;

/** What the panel knows: waiting on Stripe's webhook, or an order it has read. */
type Status = { kind: "loading" } | { kind: "unknown" } | { kind: "unreachable" } | { kind: "order"; order: OrderView; cancelFailed?: boolean };

/** Polls the order until it leaves `open`, one second apart for 20 s and then every 5 s (the paid state comes only from the verified webhook). */
function useOrderPoll(orderId: string, active: boolean): { order: OrderView | undefined; waitedLong: boolean } {
  const [order, setOrder] = useState<OrderView | undefined>();
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const reply = await fetchOrder(orderId);
      if (stop) return;
      if (reply.ok) setOrder(reply.value);
      const long = Date.now() - started >= HINT_AFTER_MS;
      setWaitedLong(long);
      if (!reply.ok || reply.value.state === "open") timer = setTimeout(() => void tick(), long ? SLOW_POLL_MS : FAST_POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [orderId, active]);
  return { order, waitedLong };
}

/** `checkSession` is false for a cancel that found its session completed: that page has no `session_id` to compare. */
function Success({ params, checkSession, onSettled }: { params: Params; checkSession: boolean; onSettled: () => void }) {
  const { order, waitedLong } = useOrderPoll(params.orderId, true);
  const settled = order?.state === "paid";
  useEffect(() => {
    if (settled) onSettled();
  }, [settled, onSettled]);

  if (order && checkSession && params.sessionId !== order.stripeSessionId) {
    return (
      <Alert data-testid="checkout-return" data-state="unknown">
        <AlertTitle>Unknown checkout</AlertTitle>
        <AlertDescription>This checkout does not match any order on this server.</AlertDescription>
      </Alert>
    );
  }
  if (order?.state === "paid") {
    const hosts = [...new Set(order.lines.map((l) => l.merchantHost))];
    return (
      <Alert data-testid="checkout-return" data-state="paid">
        <AlertTitle>
          <Badge variant="secondary">{ORDER_BADGE_LABELS.paid}</Badge>
        </AlertTitle>
        <AlertDescription>{paidLabel(hosts)}</AlertDescription>
      </Alert>
    );
  }
  if (order && order.state !== "open") {
    return (
      <Alert data-testid="checkout-return" data-state={order.state}>
        <AlertTitle>
          <Badge variant="secondary">{ORDER_BADGE_LABELS[order.state]}</Badge>
        </AlertTitle>
        <AlertDescription>This simulated checkout did not complete. Your cart is unchanged.</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert data-testid="checkout-return" data-state="confirming">
      <AlertTitle>Confirming simulated payment…</AlertTitle>
      {waitedLong && <AlertDescription>Still waiting for Stripe&apos;s confirmation. Is `stripe listen` running?</AlertDescription>}
    </Alert>
  );
}

function Cancelled({ params, onSettled }: { params: Params; onSettled: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    let stop = false;
    void cancelOrder(params.orderId).then(async (reply) => {
      if (stop) return;
      if (reply.ok) return setStatus({ kind: "order", order: reply.value });
      if (reply.code === "order-not-found") return setStatus({ kind: "unknown" });
      // Stripe says the session completed: the webhook, not this page, decides what happens next.
      if (reply.code === "already-completed") return setCompleted(true);
      const order = await fetchOrder(params.orderId);
      if (!stop) setStatus(order.ok ? { kind: "order", order: order.value, cancelFailed: true } : { kind: "unreachable" });
    });
    return () => {
      stop = true;
    };
  }, [params.orderId]);

  if (completed) return <Success params={params} checkSession={false} onSettled={onSettled} />;
  if (status.kind === "unknown") {
    return (
      <Alert data-testid="checkout-return" data-state="unknown">
        <AlertTitle>Unknown checkout</AlertTitle>
      </Alert>
    );
  }
  if (status.kind === "loading") return null;
  if (status.kind === "unreachable") {
    return (
      <Alert data-testid="checkout-return" data-state="unreachable">
        <AlertTitle>Could not reach Kensaku&apos;s server to cancel the checkout.</AlertTitle>
      </Alert>
    );
  }
  const declined = status.order.declinedAttempts >= 1;
  return (
    <Alert data-testid="checkout-return" data-state="cancelled">
      <AlertTitle>Simulated checkout cancelled. Your cart is unchanged.</AlertTitle>
      {status.cancelFailed && <AlertDescription>Stripe could not confirm the cancellation, so the checkout link may still work.</AlertDescription>}
      {declined && <AlertDescription>The test card was declined.</AlertDescription>}
    </Alert>
  );
}

/** The panel for `/?checkout=success|cancelled&order=…`. `onSettled` fires when the order is paid, so the page can reload its cart. */
export function CheckoutReturn({ params, onSettled, onDismiss }: { params: Params; onSettled: () => void; onDismiss: () => void }) {
  return (
    <div className="space-y-2">
      {params.outcome === "success" ? <Success params={params} checkSession onSettled={onSettled} /> : <Cancelled params={params} onSettled={onSettled} />}
      <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
