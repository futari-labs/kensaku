import { useEffect, useState } from "react";
import { ORDER_BADGE_LABELS, paidLabel } from "../../core/commerce";
import { Alert, AlertDescription, AlertTitle } from "@/web/components/ui/alert";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { cancelOrder, fetchOrder } from "./commerce";
import type { CheckoutReturn as Params, OrderView, Reply } from "./commerce";
import { isSettled, returnViewOf } from "./returnView";
import type { EndedState, ReturnView } from "./returnView";
import { useCart } from "./useCart";

const FAST_POLL_MS = 1_000;
const SLOW_POLL_MS = 5_000;
const HINT_AFTER_MS = 20_000;

const ENDED_TEXT: Record<EndedState, string> = {
  expired: "This simulated checkout expired. Your cart is unchanged.",
  failed: "This simulated checkout could not be started. Your cart is unchanged.",
  payment_failed: "The simulated payment failed. Your cart is unchanged.",
};

function usePanel(params: Params): { view: ReturnView; waitedLong: boolean } {
  const [cancelReply, setCancelReply] = useState<Reply<OrderView> | undefined>();
  const [order, setOrder] = useState<Reply<OrderView> | undefined>();
  const [waitedLong, setWaitedLong] = useState(false);
  const { orderId, outcome } = params;

  useEffect(() => {
    if (outcome !== "cancelled") return;
    let stop = false;
    void cancelOrder(orderId).then((reply) => !stop && setCancelReply(reply));
    return () => {
      stop = true;
    };
  }, [orderId, outcome]);

  const view = returnViewOf(params, cancelReply, order);
  const polling = (outcome === "success" || cancelReply !== undefined) && !isSettled(view);
  useEffect(() => {
    if (!polling) return;
    let stop = false;
    let long = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A timer of its own, so the hint does not wait for the next poll to answer.
    const hint = setTimeout(() => {
      long = true;
      setWaitedLong(true);
    }, HINT_AFTER_MS);
    const tick = async () => {
      const reply = await fetchOrder(orderId);
      if (stop) return;
      setOrder((previous) => (reply.ok || reply.status === 404 || previous === undefined ? reply : previous));
      timer = setTimeout(() => void tick(), long ? SLOW_POLL_MS : FAST_POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
      clearTimeout(hint);
    };
  }, [orderId, polling]);

  return { view, waitedLong };
}

function Panel({ view, waitedLong }: { view: ReturnView; waitedLong: boolean }) {
  switch (view.kind) {
    case "pending":
      return null;
    case "confirming":
      return (
        <Alert role="status" aria-live="polite" data-testid="checkout-return" data-state="confirming">
          <AlertTitle>Confirming simulated payment…</AlertTitle>
          {waitedLong && <AlertDescription>Still waiting for Stripe&apos;s confirmation. Is `stripe listen` running?</AlertDescription>}
        </Alert>
      );
    case "paid":
      return (
        <Alert role="status" aria-live="polite" data-testid="checkout-return" data-state="paid">
          <AlertTitle>
            <Badge variant="secondary">{ORDER_BADGE_LABELS.paid}</Badge>
          </AlertTitle>
          <AlertDescription>{paidLabel(view.hosts)}</AlertDescription>
        </Alert>
      );
    case "cancelled":
      return (
        <Alert role="status" aria-live="polite" data-testid="checkout-return" data-state="cancelled">
          <AlertTitle>Simulated checkout cancelled. Your cart is unchanged.</AlertTitle>
          {view.declined && <AlertDescription>The test card was declined.</AlertDescription>}
        </Alert>
      );
    case "cancel-failed":
      return (
        <Alert role="status" aria-live="polite" data-testid="checkout-return" data-state="cancel-failed">
          <AlertTitle>The simulated checkout is still open.</AlertTitle>
          <AlertDescription>Stripe could not confirm the cancellation, so the checkout link may still work. Your cart is unchanged.</AlertDescription>
        </Alert>
      );
    case "ended":
      return (
        <Alert role="status" aria-live="polite" data-testid="checkout-return" data-state={view.state}>
          <AlertTitle>
            <Badge variant="secondary">{ORDER_BADGE_LABELS[view.state]}</Badge>
          </AlertTitle>
          <AlertDescription>{ENDED_TEXT[view.state]}</AlertDescription>
        </Alert>
      );
    case "unknown":
      return (
        <Alert role="status" aria-live="polite" data-testid="checkout-return" data-state="unknown">
          <AlertTitle>Unknown checkout</AlertTitle>
          <AlertDescription>This checkout does not match any order on this server.</AlertDescription>
        </Alert>
      );
    case "unreachable":
      return (
        <Alert role="status" aria-live="polite" data-testid="checkout-return" data-state="unreachable">
          <AlertTitle>Could not reach Kensaku&apos;s server to check the checkout.</AlertTitle>
        </Alert>
      );
  }
}

export function CheckoutReturn({ params, onDismiss }: { params: Params; onDismiss: () => void }) {
  const { refresh } = useCart();
  const { view, waitedLong } = usePanel(params);
  const paid = view.kind === "paid";
  useEffect(() => {
    if (paid) void refresh();
  }, [paid, refresh]);

  return (
    <div className="space-y-2">
      <Panel view={view} waitedLong={waitedLong} />
      <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
