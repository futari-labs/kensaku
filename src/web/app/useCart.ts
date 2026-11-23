import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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

/** `corrupt`: the server answered 503 commerce-unavailable (its data file could not be read). `unreachable`: no usable answer. */
export type CartUnavailable = "corrupt" | "unreachable";

export type OfferBlockCode = Extract<CartErrorCode, "offer-not-registered" | "out-of-stock" | "invalid-price" | "below-minimum">;
export type BuyBlockCode = OfferBlockCode | CartUnavailable;

/** Why an offer cannot be added: `label` is the disabled button's text, `detail` explains it. A failed add shows the same `detail`. */
export const BUY_BLOCK: Record<BuyBlockCode, { label: string; detail: string }> = {
  "offer-not-registered": { label: "Ask again to buy", detail: "This offer was saved before the simulated cart existed. Ask the question again to make it buyable." },
  "out-of-stock": { label: "Out of stock", detail: "The merchant listed this offer as out of stock." },
  "invalid-price": { label: "Price can't be charged", detail: "This price is not a valid amount in its currency, so it cannot be simulated." },
  "below-minimum": { label: "Below Stripe's minimum", detail: "Stripe's sandbox cannot charge an amount this small." },
  corrupt: { label: "Cart disabled", detail: "Kensaku could not read its commerce data file. See the server log." },
  unreachable: { label: "Cart disabled", detail: "Kensaku's server could not be reached." },
};

const isOfferBlock = (code: string): code is OfferBlockCode => code !== "corrupt" && code !== "unreachable" && Object.hasOwn(BUY_BLOCK, code);

const NOTICE_TEXT: Record<Exclude<CartNotice["code"], "currency-mismatch" | OfferBlockCode>, string> = {
  "invalid-request": "That request could not be read.",
  "quantity-out-of-range": `Choose between 1 and ${MAX_LINE_QUANTITY}.`,
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
  if (isOfferBlock(code)) return BUY_BLOCK[code].detail;
  if (code !== "currency-mismatch") return NOTICE_TEXT[code];
  return details ? `The cart holds ${details.cartCurrency} items. Clear it to add ${details.offerCurrency} items.` : "The cart holds items in another currency. Clear it first.";
}

const isNoticeCode = (code: string): code is CartNotice["code"] => code === "currency-mismatch" || isOfferBlock(code) || Object.hasOwn(NOTICE_TEXT, code);

const noticeOf = (reply: Extract<Reply<unknown>, { ok: false }>): CartNotice => ({
  code: isNoticeCode(reply.code) ? reply.code : "unknown",
  ...(reply.details && { details: reply.details }),
});

export function useCartState(fixture: boolean) {
  const [view, setView] = useState<CartView | undefined>();
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [unavailable, setUnavailable] = useState<CartUnavailable | undefined>();
  const [notice, setNotice] = useState<CartNotice | undefined>();
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);

  const writes = useRef(0);

  const refresh = useCallback(async () => {
    const writesBefore = writes.current;
    const [cart, list] = await Promise.all([fetchCart(), fetchOrders()]);
    if (cart.ok) {
      if (writes.current === writesBefore) setView(cart.value);
      setUnavailable(undefined);
    } else setUnavailable(cart.code === "commerce-unavailable" ? "corrupt" : "unreachable");
    if (list.ok) setOrders(list.value.orders);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Applies a cart reply. Resolves to the failure, or undefined on success. */
  const apply = useCallback(async (request: Promise<Reply<CartView["cart"]>>): Promise<CartNotice | undefined> => {
    writes.current += 1;
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

  const applyWithSheetNotice = useCallback(
    async (request: Promise<Reply<CartView["cart"]>>) => {
      const failure = await apply(request);
      setNotice(failure);
    },
    [apply],
  );
  const setLineQuantity = useCallback((offerId: string, quantity: number) => applyWithSheetNotice(setQuantity(offerId, quantity)), [applyWithSheetNotice]);
  const remove = useCallback((offerId: string) => applyWithSheetNotice(removeLine(offerId)), [applyWithSheetNotice]);
  const clear = useCallback(() => applyWithSheetNotice(clearCart()), [applyWithSheetNotice]);

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
