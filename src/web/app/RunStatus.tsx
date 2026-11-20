import { Alert, AlertDescription, AlertTitle } from "@/web/components/ui/alert";
import { Shimmer } from "@/web/components/ai-elements/shimmer";
import { STAGES } from "../../research/events";
import type { ApiErrorKind, ProgressData, UsageData } from "../../research/events";

const STAGE_LABEL = {
  candidates: "Finding candidates",
  offers: "Gathering offers",
  validate: "Validating offers",
  compare: "Writing the comparison",
} as const;

/** The four stages in order, announced to assistive technology as they change. */
export function Progress({ progress }: { progress: ProgressData[] }) {
  const latest = new Map(progress.map((p) => [p.stage, p]));
  return (
    <ol className="space-y-1 text-sm" aria-label="Research progress" role="status" aria-live="polite" data-testid="progress">
      {STAGES.map((stage) => {
        const p = latest.get(stage);
        const status = p?.status ?? "pending";
        return (
          <li key={stage} data-stage={stage} data-status={status} className="flex items-center gap-2">
            <span aria-hidden="true" className="w-4 text-center">
              {status === "done" ? "✓" : status === "failed" ? "✗" : status === "running" ? "…" : "·"}
            </span>
            {status === "running" ? <Shimmer as="span">{STAGE_LABEL[stage]}</Shimmer> : <span>{STAGE_LABEL[stage]}</span>}
            <span className="sr-only">{status}</span>
            {p?.detail && status === "done" && <span className="text-xs text-muted-foreground">({p.detail})</span>}
          </li>
        );
      })}
    </ol>
  );
}

const ERROR_TEXT: Record<ApiErrorKind, string> = {
  auth: "Exa rejected the API key. Check EXA_API_KEY on the server.",
  credits_exhausted: "Exa reports the free credits are exhausted. Live calls stay blocked until you add credits and delete the usage ledger.",
  monthly_limit: "The monthly Exa request or cost limit is reached. Raise the limit in the environment or wait for next month.",
  rate_limited: "Exa is rate limiting requests. Try again in a moment.",
  upstream: "Exa is unavailable. Try again in a moment.",
  timeout: "The Exa request timed out. Try again.",
  invalid_request: "The request was not valid.",
  run_in_progress: "A research run is already in progress.",
};

export function ErrorNotice({ error }: { error: { kind: ApiErrorKind; partial: boolean } }) {
  return (
    <Alert variant="destructive" data-testid="run-error" data-kind={error.kind}>
      <AlertTitle>{error.partial ? "The run failed; the results below are partial" : "The run failed"}</AlertTitle>
      <AlertDescription>{ERROR_TEXT[error.kind]}</AlertDescription>
    </Alert>
  );
}

export function UsageFooter({ usage }: { usage: UsageData }) {
  return (
    <p className="text-xs text-muted-foreground" data-testid="usage">
      Exa requests: {usage.exaRequests} · cache hits: {usage.cacheHits} · reported cost: ${usage.costDollars.toFixed(3)} · this month:{" "}
      {usage.monthRequests} of {usage.monthLimit} requests
    </p>
  );
}
