import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { MAX_LINES, MAX_LINE_QUANTITY, cartTotalMinor } from "../../core/commerce";
import type { CartErrorCode, CheckoutErrorCode, CurrencyMismatch } from "../../core/commerce";
import { addToCart, clearCart, fetchCart, fetchOrders, isCheckoutUrl, removeLine, setQuantity, startCheckout } from "./commerce";
import type { CartView, OrderView, Reply } from "./commerce";

export const ADDED_MESSAGE = "Added to simulated cart";

/** A failed cart or checkout call, kept as data until it is shown. `unknown` is any code this page does not recognise. */
export interface CartNotice {
  code: CartErrorCode | CheckoutErrorCode | "commerce-unavailable" | "unknown";
  details?: CurrencyMismatch;
}

const NOTICE_TEXT: Record<Exclude<CartNotice["code"], "currency-mismatch">, string> = {
  "invalid-request": "That request could not be read.",
  "quantity-out-of-range": `Choose between 1 and ${MAX_LINE_QUANTITY}.`,
  "offer-not-registered": "This offer is no longer available to buy. Ask again.",
  "out-of-stock": "This offer is out of stock.",
  "invalid-price": "This price can't be charged.",
  "below-minimum": "This price is below Stripe's minimum.",
  "quantity-limit": `At most ${MAX_LINE_QUANTITY} of one offer.`,
  "line-limit": `At most ${MAX_LINES} different offers.`,
  "total-too-large": "The cart total would be too large.",
  "not-in-cart": "That offer is not in the cart.",
  "cart-empty": "The simulated cart is empty.",
  "commerce-unavailable": "The simulated cart is unavailable. See the server log.",
  "checkout-failed": "Couldn't start the Stripe sandbox checkout. Your cart is unchanged.",
  "checkout-not-configured": "Stripe sandbox is not configured. See README.",
  unknown: "Something went wrong with the simulated cart.",
};

export function noticeText({ code, details }: CartNotice): string {
  if (code !== "currency-mismatch") return NOTICE_TEXT[code];
  return details ? `The cart holds ${details.cartCurrency} items. Clear it to add ${details.offerCurrency} items.` : "The cart holds items in another currency. Clear it first.";
}

const isNoticeCode = (code: string): code is CartNotice["code"] => code === "currency-mismatch" || Object.hasOwn(NOTICE_TEXT, code);

const noticeOf = (reply: Extract<Reply<unknown>, { ok: false }>): CartNotice => ({
  code: isNoticeCode(reply.code) ? reply.code : "unknown",
  ...(reply.details && { details: reply.details }),
});

/** `corrupt`: the server answered 503 commerce-unavailable (its data file could not be read). `unreachable`: no usable answer. */
export type CartUnavailable = "corrupt" | "unreachable";

export function useCartState(fixture: boolean) {
  const [view, setView] = useState<CartView | undefined>();
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [unavailable, setUnavailable] = useState<CartUnavailable | undefined>();
  const [notice, setNotice] = useState<CartNotice | undefined>();
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);

  /** Reads the cart and the order list; the sheet calls it on open so a webhook that landed while it was closed shows. */
  const refresh = useCallback(async () => {
    const [cart, list] = await Promise.all([fetchCart(), fetchOrders()]);
    if (cart.ok) {
      setView(cart.value);
      setUnavailable(undefined);
    } else setUnavailable(cart.code === "commerce-unavailable" ? "corrupt" : "unreachable");
    if (list.ok) setOrders(list.value.orders);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Applies a cart reply. Resolves to the failure, or undefined on success. */
  const apply = useCallback(async (request: Promise<Reply<CartView["cart"]>>): Promise<CartNotice | undefined> => {
    const reply = await request;
    if (!reply.ok) return noticeOf(reply);
    setView((current) => (current ? { ...current, cart: reply.value, totalMinor: cartTotalMinor(reply.value) } : current));
    return undefined;
  }, []);

  /** The caller shows a failed add beside its own button; the sheet's notice is for the sheet's own controls. */
  const add = useCallback(
    async (offerId: string, { replace = false }: { replace?: boolean } = {}): Promise<CartNotice | undefined> => {
      const failure = await apply(addToCart(offerId, replace));
      if (!failure) {
        setNotice(undefined);
        setAnnouncement(ADDED_MESSAGE);
      }
      return failure;
    },
    [apply],
  );

  const inSheet = useCallback(
    async (request: Promise<Reply<CartView["cart"]>>) => {
      const failure = await apply(request);
      setNotice(failure);
    },
    [apply],
  );
  const setLineQuantity = useCallback((offerId: string, quantity: number) => inSheet(setQuantity(offerId, quantity)), [inSheet]);
  const remove = useCallback((offerId: string) => inSheet(removeLine(offerId)), [inSheet]);
  const clear = useCallback(() => inSheet(clearCart()), [inSheet]);

  const checkout = useCallback(async () => {
    setBusy(true);
    setNotice(undefined);
    const reply = await startCheckout();
    if (reply.ok && isCheckoutUrl(reply.value.url, fixture)) {
      window.location.assign(reply.value.url);
      return;
    }
    setNotice(reply.ok ? { code: "checkout-failed" } : noticeOf(reply));
    setBusy(false);
  }, [fixture]);

  return { view, orders, unavailable, notice, announcement, busy, refresh, add, setLineQuantity, remove, clear, checkout };
}

export type CartState = ReturnType<typeof useCartState>;

export const CartContext = createContext<CartState | undefined>(undefined);

export function useCart(): CartState {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart needs a CartContext provider");
  return cart;
}
