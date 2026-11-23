import { useId } from "react";
import { MinusIcon, PlusIcon, ShoppingCartIcon, Trash2Icon } from "lucide-react";
import { CART_TITLE, CHECKOUT_BUTTON_LABEL, MAX_LINE_QUANTITY, ORDER_BADGE_LABELS, SIMULATION_BANNER, demoPriceLabel, demoTotalLabel, formatMinor, observedPriceLabel } from "../../core/commerce";
import type { CartLine } from "../../core/commerce";
import { Alert, AlertDescription } from "@/web/components/ui/alert";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/web/components/ui/button-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/web/components/ui/item";
import { Separator } from "@/web/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/web/components/ui/sheet";
import type { OrderView } from "./commerce";
import { formatTime } from "./format";
import { hostsOf, linkExpired } from "./returnView";
import { noticeText, useCart } from "./useCart";

function Line({ line }: { line: CartLine }) {
  const { setLineQuantity, remove } = useCart();
  const currency = line.observed.currency;
  return (
    <Item variant="outline" size="sm" role="listitem" data-testid="cart-line">
      <ItemContent>
        <ItemTitle>{line.productName}</ItemTitle>
        <ItemDescription className="line-clamp-none">{line.merchantHost}</ItemDescription>
        <p className="text-sm font-medium" data-testid="demo-price">
          {demoPriceLabel(line.demoUnitAmountMinor, currency)}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="observed-price">
          {observedPriceLabel(line.observed, formatTime(line.observed.retrievedAt))}
        </p>
      </ItemContent>
      <ItemActions className="w-full justify-between">
        <ButtonGroup aria-label={`Quantity of ${line.productName}`}>
          <Button type="button" variant="outline" size="icon-sm" aria-label={`Decrease quantity of ${line.productName}`} disabled={line.quantity <= 1} onClick={() => void setLineQuantity(line.offerId, line.quantity - 1)}>
            <MinusIcon aria-hidden="true" />
          </Button>
          <ButtonGroupText className="min-w-8 justify-center px-2 tabular-nums" data-testid="line-quantity">
            <span aria-hidden="true">{line.quantity}</span>
            <span className="sr-only">Quantity {line.quantity}</span>
          </ButtonGroupText>
          <Button type="button" variant="outline" size="icon-sm" aria-label={`Increase quantity of ${line.productName}`} disabled={line.quantity >= MAX_LINE_QUANTITY} onClick={() => void setLineQuantity(line.offerId, line.quantity + 1)}>
            <PlusIcon aria-hidden="true" />
          </Button>
        </ButtonGroup>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${line.productName} from simulated cart`} onClick={() => void remove(line.offerId)}>
          <Trash2Icon aria-hidden="true" />
        </Button>
      </ItemActions>
    </Item>
  );
}

function OrderRow({ order, now }: { order: OrderView; now: number }) {
  const count = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <Item variant="outline" size="sm" role="listitem" data-testid="order-row" data-state={order.state}>
      <ItemContent>
        <ItemTitle>
          <Badge variant="secondary">{ORDER_BADGE_LABELS[order.state]}</Badge>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {count} {count === 1 ? "item" : "items"} from {hostsOf(order.lines).join(", ")} · {formatMinor(order.totalMinor, order.currency)} {order.currency} · <time dateTime={order.createdAt}>{formatTime(order.createdAt)}</time>
        </ItemDescription>
        {linkExpired(order, now) && <p className="text-xs text-muted-foreground">Checkout link expired</p>}
      </ItemContent>
    </Item>
  );
}

export function CartSheet() {
  const { view, orders, unavailable, notice, busy, refresh, clear, checkout } = useCart();
  const lines = view?.cart.lines ?? [];
  const currency = view?.cart.currency;
  const configured = view?.checkoutConfigured ?? false;
  const ordersHeadingId = useId();
  const now = Date.now();
  return (
    <Sheet onOpenChange={(open) => open && void refresh()}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`Open simulated cart, ${lines.length} items`} data-testid="cart-button" disabled={unavailable !== undefined}>
          <ShoppingCartIcon aria-hidden="true" />
          <span data-testid="cart-count">{lines.length}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{CART_TITLE}</SheetTitle>
          <SheetDescription>{SIMULATION_BANNER}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
          {notice && (
            <Alert data-testid="cart-notice">
              <AlertDescription className="flex items-center justify-between gap-3">
                {noticeText(notice)}
                {notice.code === "checkout-failed" && (
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void checkout()}>
                    Try again
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Your simulated cart is empty.</p>
          ) : (
            <ItemGroup aria-label="Cart lines">
              {lines.map((line) => (
                <Line key={line.offerId} line={line} />
              ))}
            </ItemGroup>
          )}
          {orders.length > 0 && (
            <section aria-labelledby={ordersHeadingId} className="space-y-2" data-testid="orders">
              <h3 id={ordersHeadingId} className="text-sm font-semibold">
                Recent simulated orders
              </h3>
              <ItemGroup>
                {orders.map((order) => (
                  <OrderRow key={order.orderId} order={order} now={now} />
                ))}
              </ItemGroup>
            </section>
          )}
        </div>
        <SheetFooter>
          <Separator />
          {currency && view && (
            <p className="text-base font-semibold" data-testid="demo-total">
              {demoTotalLabel(view.totalMinor, currency)}
            </p>
          )}
          <Button type="button" disabled={lines.length === 0 || !configured || busy} onClick={() => void checkout()}>
            {CHECKOUT_BUTTON_LABEL}
          </Button>
          <Button type="button" variant="outline" disabled={lines.length === 0 || busy} onClick={() => void clear()}>
            Clear cart
          </Button>
          {!configured && <p className="text-xs text-muted-foreground">Stripe sandbox is not configured. See README.</p>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
