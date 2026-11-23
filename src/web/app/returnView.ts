import type { CartLine, OrderState } from "../../core/commerce";
import type { CheckoutReturn, OrderView, Reply } from "./commerce";

export type EndedState = Exclude<OrderState, "open" | "paid" | "cancelled">;

/** What the checkout-return panel shows. One value, one render switch. */
export type ReturnView =
  | { kind: "pending" }
  | { kind: "confirming" }
  | { kind: "paid"; hosts: string[] }
  | { kind: "cancelled"; declined: boolean }
  | { kind: "cancel-failed" }
  | { kind: "ended"; state: EndedState }
  | { kind: "unknown" }
  | { kind: "unreachable" };

/** A view the order can still change under: the panel keeps reading the order while it shows one. */
export const isSettled = (view: ReturnView): boolean => view.kind !== "pending" && view.kind !== "confirming" && view.kind !== "cancel-failed" && view.kind !== "unreachable";

export const hostsOf = (lines: CartLine[]): string[] => [...new Set(lines.map((line) => line.merchantHost))];

export const linkExpired = ({ state, expiresAt }: OrderView, now: number): boolean => state === "open" && expiresAt !== null && Date.parse(expiresAt) <= now;

/**
 * `cancelReply` is the answer to the cancel this page posted (undefined until it arrives, and always for a
 * success return); `order` is the latest answer to reading the order.
 */
export function returnViewOf(params: CheckoutReturn, cancelReply: Reply<OrderView> | undefined, order: Reply<OrderView> | undefined): ReturnView {
  const cancelling = params.outcome === "cancelled";
  if (cancelling && cancelReply === undefined) return { kind: "pending" };
  const read = order ?? (cancelReply?.ok ? cancelReply : undefined);
  if (read === undefined) return cancelling ? { kind: "pending" } : { kind: "confirming" };
  if (!read.ok) {
    if (read.status === 404) return { kind: "unknown" };
    return cancelling ? { kind: "unreachable" } : { kind: "confirming" };
  }
  const { value } = read;
  if (!cancelling && params.sessionId !== value.stripeSessionId) return { kind: "unknown" };
  switch (value.state) {
    case "paid":
      return { kind: "paid", hosts: hostsOf(value.lines) };
    case "cancelled":
      return { kind: "cancelled", declined: value.declinedAttempts >= 1 };
    case "open":
      return cancelling && !(cancelReply?.ok === false && cancelReply.code === "already-completed") ? { kind: "cancel-failed" } : { kind: "confirming" };
    default:
      return { kind: "ended", state: value.state };
  }
}
