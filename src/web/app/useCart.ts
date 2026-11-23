import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { cartTotalMinor } from "../../core/commerce";
import { addToCart, fetchCart, isCheckoutUrl, removeLine, setQuantity, startCheckout } from "./commerce";
import type { CartView, Reply } from "./commerce";

export const ADDED_MESSAGE = "Added to simulated cart";

const CART_ERROR: Record<string, string> = {
  "offer-not-registered": "This offer is no longer available to buy. Ask again.",
  "out-of-stock": "This offer is out of stock.",
  "invalid-price": "This price can't be charged.",
  "below-minimum": "This price is below Stripe's minimum.",
  "quantity-limit": "At most 10 of one offer.",
  "line-limit": "At most 20 different offers.",
  "total-too-large": "The cart total would be too large.",
  "commerce-unavailable": "The simulated cart is unavailable. See the server log.",
  "checkout-failed": "Could not start the Stripe sandbox checkout. Try again.",
  "checkout-not-configured": "Stripe sandbox is not configured. See README.",
};

const messageOf = (reply: Extract<Reply<unknown>, { ok: false }>): string =>
  reply.code === "currency-mismatch" && reply.details
    ? `The cart holds ${reply.details.cartCurrency} items. Clear it to add ${reply.details.offerCurrency} items.`
    : (CART_ERROR[reply.code] ?? "Something went wrong with the simulated cart.");

export function useCartState(fixture: boolean) {
  const [view, setView] = useState<CartView | undefined>();
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const reply = await fetchCart();
    if (reply.ok) {
      setView(reply.value);
      setUnavailable(false);
    } else setUnavailable(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const change = useCallback(async (request: Promise<Reply<CartView["cart"]>>, announce?: string): Promise<boolean> => {
    const reply = await request;
    if (reply.ok) {
      setView((current) => (current ? { ...current, cart: reply.value, totalMinor: cartTotalMinor(reply.value) } : current));
      setNotice(undefined);
      if (announce) setAnnouncement(announce);
      return true;
    }
    setNotice(messageOf(reply));
    return false;
  }, []);

  const add = useCallback((offerId: string) => change(addToCart(offerId), ADDED_MESSAGE), [change]);
  const setLineQuantity = useCallback((offerId: string, quantity: number) => change(setQuantity(offerId, quantity)), [change]);
  const remove = useCallback((offerId: string) => change(removeLine(offerId)), [change]);

  const checkout = useCallback(async () => {
    setBusy(true);
    setNotice(undefined);
    const reply = await startCheckout();
    if (reply.ok && isCheckoutUrl(reply.value.url, fixture)) {
      window.location.assign(reply.value.url);
      return;
    }
    setNotice(reply.ok ? CART_ERROR["checkout-failed"] : messageOf(reply));
    setBusy(false);
  }, [fixture]);

  return { view, unavailable, notice, announcement, busy, refresh, add, setLineQuantity, remove, checkout };
}

export type CartState = ReturnType<typeof useCartState>;

export const CartContext = createContext<CartState | undefined>(undefined);

export function useCart(): CartState {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart needs a CartContext provider");
  return cart;
}
