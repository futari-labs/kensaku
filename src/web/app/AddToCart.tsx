import { useEffect, useId, useRef, useState } from "react";
import type { CurrencyMismatch } from "../../core/commerce";
import type { Offer } from "../../core/types";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/web/components/ui/alert-dialog";
import { Button } from "@/web/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { buyBlock } from "./offers";
import { BUY_BLOCK, noticeText, useCart } from "./useCart";
import type { CartNotice } from "./useCart";

const ADDED_FLASH_MS = 2_000;

type AddState = { kind: "idle" } | { kind: "added" } | { kind: "failed"; notice: CartNotice } | { kind: "mismatch"; details: CurrencyMismatch };

const IDLE: AddState = { kind: "idle" };

const stateOf = (failure: CartNotice | undefined): AddState => {
  if (failure === undefined) return { kind: "added" };
  return failure.code === "currency-mismatch" && failure.details ? { kind: "mismatch", details: failure.details } : { kind: "failed", notice: failure };
};

export function AddToCart({ offer }: { offer: Offer }) {
  const { add, unavailable } = useCart();
  const [state, setState] = useState<AddState>(IDLE);
  const addRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  useEffect(() => {
    if (state.kind !== "added") return;
    const timer = setTimeout(() => setState(IDLE), ADDED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const code = buyBlock(offer, unavailable);
  const block = code && BUY_BLOCK[code];
  const label = block?.label ?? (state.kind === "added" ? "Added" : "Add to cart");
  // The visible text leads the accessible name (WCAG label in name).
  const name = `${label}: ${offer.productName} from ${offer.merchantHost}${block ? "" : " (simulated cart)"}`;
  const submit = async (replace: boolean) => {
    if (offer.id === undefined) return;
    setState(stateOf(await add(offer.id, { replace })));
  };
  // aria-disabled, not disabled: the button stays focusable, so a keyboard user reaches the reason through aria-describedby.
  const button = (
    <Button
      ref={addRef}
      type="button"
      size="sm"
      aria-label={name}
      aria-disabled={block ? true : undefined}
      aria-describedby={block ? reasonId : undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-primary"
      onClick={() => !block && void submit(false)}
    >
      {label}
    </Button>
  );
  return (
    <span className="flex flex-col items-end gap-1">
      {block ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{block.detail}</TooltipContent>
          </Tooltip>
          <span id={reasonId} className="sr-only">
            {block.detail}
          </span>
        </>
      ) : (
        button
      )}
      <span role="status" aria-live="polite" className={state.kind === "failed" ? "max-w-48 text-right text-xs text-destructive" : "sr-only"} data-testid="add-error">
        {state.kind === "failed" && noticeText(state.notice)}
      </span>
      <AlertDialog open={state.kind === "mismatch"} onOpenChange={(open) => !open && setState(IDLE)}>
        {/* Radix returns focus to the dialog's trigger, and this dialog opens from a reply, so it has none. */}
        <AlertDialogContent onCloseAutoFocus={() => addRef.current?.focus()}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {state.kind === "mismatch" && `Your simulated cart has ${state.details.cartCurrency} items. Replace them with this ${state.details.offerCurrency} item?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {offer.productName} from {offer.merchantHost}. A simulated cart holds one currency.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep cart</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit(true)}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
