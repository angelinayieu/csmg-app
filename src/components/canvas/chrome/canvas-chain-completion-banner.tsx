"use client";

// ── Canvas chain-completion banner ──
//
// Problem: when the auto-advance chain completes, the user lands on
// a whiteboard full of shapes + proposal rings and has NO clear "what
// now" CTA. Intake-review wizard exists but is buried on another
// route; confirm-strategy button exists but isn't on the main canvas.
// The audit flagged this as the single biggest smoothness gap
// post-pipeline.
//
// This component:
//   • Listens to the SSE status via useStructuralEventStream so it
//     can flip from "pipeline running" to "strategy ready" the moment
//     the terminal stage completes.
//   • Checks `strategyApproved` from useSpaceData — hides after the
//     user confirms OR if the strategy was already committed before.
//   • Surfaces two CTAs:
//       Primary:  Materialize apps (direct confirm via
//                 /api/pipeline/strategy-refresh action=confirm)
//       Secondary: Review in detail (navigates to intake-review)
//   • Shows progress feedback during the confirm request itself so
//     the user doesn't wonder if the click registered.
//
// Dismissible so heavy users who know the shortcuts can close it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRunEventStore } from "../hooks/run-event-store";
import { useSpaceData } from "@/contexts/space-data-context";

export interface CanvasChainCompletionBannerProps {
  runId: string | null;
  spaceId: string;
}

type BannerState =
  | "hidden"
  | "strategy_ready"
  | "confirming"
  | "confirmed"
  | "error";

export function CanvasChainCompletionBanner({
  runId,
  spaceId,
}: CanvasChainCompletionBannerProps) {
  const router = useRouter();
  const { status, events } = useRunEventStore();
  const spaceData = useSpaceData();
  const strategyApproved = spaceData?.strategyApproved ?? false;

  const [dismissed, setDismissed] = useState(false);
  const [localState, setLocalState] = useState<BannerState>("hidden");
  const [error, setError] = useState<string | null>(null);

  // Has the run emitted at least one proposal_ready event? That's
  // our proxy for "strategy generation actually succeeded." If the
  // chain failed before strategy-refresh, we don't want to surface
  // a confirm CTA for a phantom strategy.
  const hasStrategyArtifact = useMemo(() => {
    for (const s of events) {
      if (s.event.type === "proposal_ready" && s.event.kind === "strategy") return true;
    }
    return false;
  }, [events]);

  // Decide banner visibility. Strategy-ready only shows when:
  //   - SSE status terminal + completed
  //   - At least one strategy proposal landed
  //   - Strategy not yet committed
  //   - User hasn't dismissed the banner for this run
  useEffect(() => {
    if (dismissed) {
      setLocalState("hidden");
      return;
    }
    if (strategyApproved) {
      setLocalState("confirmed");
      return;
    }
    if (status !== "completed") {
      setLocalState("hidden");
      return;
    }
    if (!hasStrategyArtifact) {
      setLocalState("hidden");
      return;
    }
    // Don't stomp confirming/error states while a POST is in flight.
    setLocalState((prev) =>
      prev === "confirming" || prev === "error" ? prev : "strategy_ready",
    );
  }, [status, hasStrategyArtifact, strategyApproved, dismissed]);

  // Reset dismissed + local state whenever we switch to a new run.
  useEffect(() => {
    setDismissed(false);
    setError(null);
    setLocalState("hidden");
  }, [runId]);

  const onConfirm = useCallback(async () => {
    if (localState === "confirming") return;
    setLocalState("confirming");
    setError(null);
    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, action: "confirm" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Confirm failed (${res.status})`);
      }
      setLocalState("confirmed");
      // Flip the in-memory approval state immediately so the banner
      // collapses without waiting for a server round-trip, then pull
      // fresh entities so newly-materialized apps land on the canvas.
      spaceData?.setStrategyApproved?.(true);
      spaceData?.refreshEntities?.();
      spaceData?.refresh?.();
    } catch (err) {
      console.warn("[completion-banner] confirm failed:", err);
      setError(err instanceof Error ? err.message : "Confirm failed");
      setLocalState("error");
    }
  }, [localState, spaceId, spaceData]);

  const onReview = useCallback(() => {
    // intake-review is the 4-step wizard; navigating keeps the
    // pipelineRunId so the user can come back to the same state.
    router.push(`/app/space/${spaceId}/intake-review`);
  }, [router, spaceId]);

  if (localState === "hidden") return null;

  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-2xl border bg-white/95 px-5 py-3.5 shadow-xl backdrop-blur-md",
        "flex max-w-[640px] items-center gap-4",
        localState === "confirmed"
          ? "border-emerald-200"
          : localState === "error"
            ? "border-red-200"
            : "border-blue-200",
      )}
    >
      <div className="flex-shrink-0">
        {localState === "confirming" ? (
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        ) : localState === "confirmed" ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <Sparkles className="h-5 w-5 text-blue-600" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-[13px] font-semibold tracking-tight text-gray-900">
          {localState === "confirming"
            ? "Materializing apps…"
            : localState === "confirmed"
              ? "Strategy confirmed — apps are live"
              : localState === "error"
                ? "Confirm failed"
                : "Strategy ready — review and confirm to materialize apps"}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
          {localState === "confirming"
            ? "Building app cards, linking interventions, seeding metric trackers."
            : localState === "confirmed"
              ? "Visit the dashboard to see what was generated."
              : localState === "error"
                ? error ?? "Something went wrong. Try again or review in detail."
                : "Your strategy is queued but not yet applied. Materialize to create app cards, link trackers, and start measuring."}
        </div>
      </div>

      {localState === "strategy_ready" && (
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            onClick={onReview}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            Review in detail
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:-translate-y-px hover:shadow-md transition-all"
          >
            Materialize apps
          </button>
        </div>
      )}

      {localState === "error" && (
        <button
          onClick={onConfirm}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50"
        >
          Retry
        </button>
      )}

      <button
        onClick={() => setDismissed(true)}
        className="ml-1 flex-shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
