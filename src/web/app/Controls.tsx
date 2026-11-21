import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/web/components/ui/alert-dialog";
import { Button } from "@/web/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import type { Market } from "../../core/types";
import { MARKETS, MARKET_LABEL } from "./markets";

export function MarketSelect({ value, onChange, disabled }: { value: Market; onChange: (market: Market) => void; disabled: boolean }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(MARKETS.find((m) => m === next) ?? value)} disabled={disabled}>
      <SelectTrigger size="sm" aria-label="Market" data-testid="market-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MARKETS.map((market) => (
          <SelectItem key={market} value={market}>
            {MARKET_LABEL[market]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ClearHistory({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          Clear history
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear history?</AlertDialogTitle>
          <AlertDialogDescription>This removes the saved conversation from this browser. It cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep history</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Clear history</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
