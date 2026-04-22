"use client";

// ── Canvas credit-exhaustion banner ──
//
// When a pipeline stage fails because the LLM provider reported
// `insufficient_quota` / `credit balance too low` / 402, we need to
// surface THAT specifically — not bury it inside a generic "Intake…
// error" badge. Otherwise the user thinks the product is broken when
// they just need to top up.
//
// Detection: poll the run-context endpoint (already-warm cache from
// the run-context panel's poll), read `errorMessage`. If it matches
// any credit-exhaustion pattern AND run status is terminal, show a
// prominent non-dismissible banner with a link to /app/credits.
//
// Why poll + detect vs. SSE push: the SSE event bus doesn't carry
// error_message (only status transitions). The run_context endpoint
// joins pipeline_runs and includes error_message. Reusing the same
// endpoint the audit panel already polls keeps this cheap.

import { useEffect, useMemo, useState } from "react";
import { Zap, X } from "lucide-react";
import type { RunContext } from "@/lib/events/run-context";

export interface CanvasCreditExhaustionBannerProps {
  runId: string | null;
}

const POLL_INTERVAL_MS = 8_000;

const CREDIT_PATTERNS = [
  /insufficient[_\s-]*quota/i,
  /credit[_\s-]*balance/i,
  /billing[_\s-]*hard[_\s-]*limit/i,
  /quota[_\s-]*exhausted/i,
  /402/,
  /rate[_\s-]*limit[_\s-]*reached/i,
];

function isCreditErrorMessage(msg: string | null): boolean {
  if (!msg) return false;
  return CREDIT_PATTERNS.some((p) => p.test(msg));
}

export function CanvasCreditExhaustionBanner({
  runId,
}: CanvasCreditExhaustionBannerProps) {
  const [ctx, setCtx] = useState<RunContext | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    setCtx(null);
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const fetchIt = async () => {
      try {
        const res = await fetch(`/api/pipeline/runs/${runId}/context`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as RunContext;
        if (!cancelled) setCtx(data);
      } catch {
        // Transient network error — keep last good state.
      }
    };
    fetchIt();
    // Only poll while the run hasn't reached a terminal state. Once
    // failed/completed, the error_message is final and we can stop
    // hammering the endpoint.
    const interval = setInterval(() => {
      if (ctx?.status === "completed" || ctx?.status === "failed") return;
      void fetchIt();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId, ctx?.status]);

  const shouldShow = useMemo(() => {
    if (dismissed) return false;
    if (!ctx) return false;
    if (ctx.status !== "failed") return false;
    return isCreditErrorMessage(ctx.errorMessage);
  }, [ctx, dismissed]);

  if (!shouldShow) return null;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-[140px] z-40 -translate-x-1/2 rounded-2xl border border-amber-300/70 bg-gradient-to-br from-amber-50 to-orange-50 px-4 py-3 shadow-xl"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-amber-100">
          <Zap className="h-3.5 w-3.5 text-amber-700" />
        </div>
        <div className="min-w-0 max-w-[420px]">
          <div className="text-[12.5px] font-semibold text-amber-900">
            Pipeline paused — LLM credits exhausted
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-amber-800">
            Your LLM provider reported insufficient quota mid-run. Add credits
            and re-submit this prompt from the home screen.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <a
              href="/app/credits"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:-translate-y-px hover:shadow-md transition-all"
            >
              Add credits →
            </a>
            <button
              onClick={() => setDismissed(true)}
              className="rounded-md p-1 text-amber-600 hover:bg-amber-100"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
