export const EXA_FAILURE_KINDS = [
  "auth",
  "credits_exhausted",
  "monthly_limit",
  "rate_limited",
  "upstream",
  "timeout",
  "budget_exhausted",
] as const;

export type ExaFailureKind = (typeof EXA_FAILURE_KINDS)[number];

export class ExaFailure extends Error {
  readonly kind: ExaFailureKind;
  readonly retryAfterMs?: number;
  /** HTTP status of the upstream reply, when there was one. */
  readonly status?: number;

  constructor(kind: ExaFailureKind, message: string, options: { retryAfterMs?: number; status?: number } = {}) {
    super(message);
    this.name = "ExaFailure";
    this.kind = kind;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.status !== undefined) this.status = options.status;
  }
}

const CREDIT_TEXT = /\b(credits?|quota|billing|payment required|insufficient (funds|balance))\b/i;

function numberField(value: unknown, field: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = (value as Record<string, unknown>)[field];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Best effort: exa-js 2.29 does not surface the Retry-After header, only the error envelope. */
function retryAfterMs(error: unknown): number | undefined {
  const detail = typeof error === "object" && error !== null ? (error as { detail?: unknown }).detail : undefined;
  const seconds = numberField(detail, "retryAfter") ?? numberField(detail, "retry_after");
  return seconds !== undefined && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

/**
 * Maps anything thrown by an Exa call to an ExaFailure. Messages are fixed text plus the HTTP
 * status, never the upstream message, so nothing from a request or header can leak through.
 */
export function mapExaError(error: unknown): ExaFailure {
  if (error instanceof ExaFailure) return error;
  const name = error instanceof Error ? error.name : "";
  const status = numberField(error, "statusCode") ?? numberField(error, "status");
  const text = error instanceof Error ? error.message : "";

  if (name === "AbortError" || name === "TimeoutError" || status === 408) {
    return new ExaFailure("timeout", "The Exa request timed out or was aborted.");
  }
  if (status === 402 || CREDIT_TEXT.test(text)) {
    return new ExaFailure("credits_exhausted", "Exa reports that credits are exhausted.");
  }
  if (status === 401 || status === 403) {
    return new ExaFailure("auth", `Exa rejected the API key (HTTP ${status}).`);
  }
  if (status === 429) {
    const ms = retryAfterMs(error);
    return new ExaFailure("rate_limited", "Exa rate limit reached (HTTP 429).", { status, ...(ms !== undefined && { retryAfterMs: ms }) });
  }
  return new ExaFailure(
    "upstream",
    status === undefined ? "The Exa request failed." : `Exa request failed (HTTP ${status}).`,
    status === undefined ? {} : { status },
  );
}
