import type { Availability, Currency } from "./types";

/** Supported currencies in fallback display order, with the decimal places a valid price may carry. */
export const MINOR_DIGITS = { USD: 2, SGD: 2, JPY: 0 } as const satisfies Record<Currency, number>;

export const CURRENCIES = Object.keys(MINOR_DIGITS) as Currency[];

export function isSupportedCurrency(code: string): code is Currency {
  return Object.hasOwn(MINOR_DIGITS, code);
}

const AVAILABILITIES: readonly Availability[] = ["in_stock", "out_of_stock", "preorder", "unknown"];

export function isAvailability(value: string | undefined): value is Availability {
  return AVAILABILITIES.some((availability) => availability === value);
}

/** True when the price is positive, finite, and has no more decimal places than the currency allows (exact, no tolerance). */
export function hasValidPrice(price: unknown, code: string): price is number {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return false;
  if (!isSupportedCurrency(code)) return true;
  const text = String(price);
  // Exponent notation only occurs for very large or very small magnitudes; those are whole numbers or far below any minor unit.
  if (text.includes("e")) return Number.isInteger(price);
  const decimals = text.split(".")[1]?.length ?? 0;
  return decimals <= MINOR_DIGITS[code];
}
