import { MinusIcon, PlusIcon, ShoppingCartIcon, Trash2Icon } from "lucide-react";
import { CART_TITLE, CHECKOUT_BUTTON_LABEL, SIMULATION_BANNER, demoPriceLabel, demoTotalLabel, observedPriceLabel } from "../../core/commerce";
import type { CartLine } from "../../core/commerce";
import { Alert, AlertDescription } from "@/web/components/ui/alert";
import { Button } from "@/web/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/web/components/ui/item";
import { Separator } from "@/web/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/web/components/ui/sheet";
import { formatTime } from "./format";
import { useCart } from "./useCart";

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
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon-sm" aria-label={`Decrease quantity of ${line.productName}`} disabled={line.quantity <= 1} onClick={() => void setLineQuantity(line.offerId, line.quantity - 1)}>
            <MinusIcon aria-hidden="true" />
          </Button>
          <span className="min-w-6 text-center tabular-nums" aria-label={`Quantity ${line.quantity}`}>
            {line.quantity}
          </span>
          <Button type="button" variant="outline" size="icon-sm" aria-label={`Increase quantity of ${line.productName}`} disabled={line.quantity >= 10} onClick={() => void setLineQuantity(line.offerId, line.quantity + 1)}>
            <PlusIcon aria-hidden="true" />
          </Button>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${line.productName} from simulated cart`} onClick={() => void remove(line.offerId)}>
          <Trash2Icon aria-hidden="true" />
        </Button>
      </ItemActions>
    </Item>
  );
}

/** The header's cart button and the sheet it opens. */
export function CartSheet() {
  const { view, unavailable, notice, busy, checkout } = useCart();
  const lines = view?.cart.lines ?? [];
  const currency = view?.cart.currency;
  const configured = view?.checkoutConfigured ?? false;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`Open simulated cart, ${lines.length} items`} data-testid="cart-button" disabled={unavailable}>
          <ShoppingCartIcon aria-hidden="true" />
          <span data-testid="cart-count">{lines.length}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{CART_TITLE}</SheetTitle>
          <SheetDescription>{SIMULATION_BANNER}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
          {notice && (
            <Alert data-testid="cart-notice">
              <AlertDescription>{notice}</AlertDescription>
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
          {!configured && <p className="text-xs text-muted-foreground">Stripe sandbox is not configured. See README.</p>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
