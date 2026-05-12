"use client";

// ── Pipeline Error/Warning Banner (Sprint C3) ─────────────────────────
//
// Chrome listener that surfaces pipeline_error + pipeline_warning
// events from the SSE stream as a dismissible accumulated trail.
//
// Why this exists: the stabilization audit identified 5 silent-fail
// paths in the strategy chain where the pipeline degraded or stopped
// without ANY user-visible signal. Sprint C2 added emits at those
// paths; this component renders them. Together they turn "the cards
// never appeared and I don't know why" into "the cards may be in
// narrative mode because no simulation chain was resolvable."
//
// Visual language:
//   • ERRORS: rose, persistent across run-complete, requires user
//     dismiss. Fatal=true adds a red header strip.
//   • WARNINGS: amber, auto-dismissed when the run completes
//     successfully (warnings about degraded paths during a run that
//     ultimately succeeded are low-value to camp). User can dismiss
//     earlier.
//   • Multiple events stack vertically up to N=5. Beyond that, a
//     "+M more" chip rolls into the bottom.
//
// Positioning: top-center, BELOW the FramingProposalGate (z-30 vs
// z-40), so the framing card stays in front when both surfaces are
// live simultaneously.
//
// Discipline:
//   • Pure event-driven. Reads from `useRunEventStore` — no polling,
//     no API fetch.
//   • Soft-fail. Malformed event payloads log + skip; never throw.
//   • Per-run-scoped dismiss state. User dismissing an event for run X
//     doesn't suppress the same event code on run Y (different stream,
//     different impact context).

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
// Use the OPTIONAL variant — this banner is mounted on the whiteboard
// page OUTSIDE the InteraxisCanvas's RunEventStoreProvider. When the
// canvas hasn't subscribed yet (early render, or banner consumer
// mounted before the canvas tree), we return null gracefully instead
// of throwing.
import { useRunEventStoreOptional } from "../hooks/run-event-store";

const MAX_VISIBLE = 5;

interface SurfacedEvent {
  /** Unique key derived from sequence + code, so dismissals survive
   *  re-renders without depending on the wire's id semantics. */
  key: string;
  sequence: number;
  kind: "warning" | "error";
  stage: string;
  code: string;
  message: string;
  fatal: boolean;
}

export function PipelineErrorBanner() {
  const store = useRunEventStoreOptional();
  // Degrade gracefully when mounted outside the provider — render
  // nothing instead of throwing. This is the documented contract for
  // chrome that lives outside the canvas's event-store boundary.
  const events = store?.events ?? [];
  const status = store?.status ?? "idle";
  const runId = store?.runId ?? null;
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  // Reset dismiss state when the runId changes — a fresh run gets
  // a fresh banner. Without this, dismissing "no_simulation_chain"
  // on run A would suppress the same code on run B even though it's
  // a different pipeline instance with different impact.
  const lastRunIdRef = useRef<string | null | undefined>(runId);
  useEffect(() => {
    if (lastRunIdRef.current !== runId) {
      lastRunIdRef.current = runId;
      setDismissedKeys(new Set());
    }
  }, [runId]);

  const surfaced = useMemo<SurfacedEvent[]>(() => {
    const out: SurfacedEvent[] = [];
    for (const s of events) {
      const ev = s.event;
      if (ev.type !== "pipeline_warning" && ev.type !== "pipeline_error") {
        continue;
      }
      const key = `${s.sequence}-${ev.code}`;
      if (dismissedKeys.has(key)) continue;
      out.push({
        key,
        sequence: s.sequence,
        kind: ev.type === "pipeline_error" ? "error" : "warning",
        stage: ev.stage,
        code: ev.code,
        message: ev.message,
        fatal: ev.type === "pipeline_error" && ev.fatal === true,
      });
    }
    // Most recent first so the latest signal sits at the top of the
    // visible stack.
    out.sort((a, b) => b.sequence - a.sequence);
    return out;
  }, [events, dismissedKeys]);

  // Auto-clear WARNINGS when the run completes successfully. Errors
  // persist — the user explicitly dismisses them. This honors the
  // discipline that warnings about transient degradation are stale
  // once the run lands; errors are lessons that should stick.
  useEffect(() => {
    if (status !== "completed") return;
    const warningKeys = events
      .filter((s) => s.event.type === "pipeline_warning")
      .map((s) => `${s.sequence}-${(s.event as { code: string }).code}`);
    if (warningKeys.length === 0) return;
    setDismissedKeys((prev) => {
      const next = new Set(prev);
      for (const k of warningKeys) next.add(k);
      return next;
    });
  }, [status, events]);

  const visible = surfaced.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, surfaced.length - MAX_VISIBLE);
  const hasError = surfaced.some((s) => s.kind === "error");

  if (visible.length === 0) return null;
  if (!runId) return null;

  return (
    <div
      className="pointer-events-auto fixed left-1/2 top-[108px] z-30 flex w-full max-w-[640px] -translate-x-1/2 flex-col gap-1.5 px-4"
      role="alert"
      aria-live="polite"
    >
      {visible.map((s) => (
        <BannerRow
          key={s.key}
          event={s}
          onDismiss={() =>
            setDismissedKeys((prev) => new Set(prev).add(s.key))
          }
        />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            "self-center rounded-full border bg-white/90 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur",
            hasError
              ? "border-rose-200 text-rose-700"
              : "border-amber-200 text-amber-700",
          )}
        >
          +{overflow} more pipeline {hasError ? "issue" : "warning"}
          {overflow === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

function BannerRow({
  event,
  onDismiss,
}: {
  event: SurfacedEvent;
  onDismiss: () => void;
}) {
  const isError = event.kind === "error";
  const Icon = isError ? AlertCircle : AlertTriangle;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm",
        "animate-in fade-in slide-in-from-top-1 duration-200",
        isError && event.fatal
          ? "border-rose-300 bg-rose-50/95"
          : isError
            ? "border-rose-200"
            : "border-amber-200",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          isError ? "text-rose-600" : "text-amber-600",
        )}
        aria-hidden
      />
      <div className="flex-1 text-[11.5px] leading-snug">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-[9px] font-bold uppercase tracking-wider",
              isError ? "text-rose-700" : "text-amber-700",
            )}
          >
            {isError ? "Pipeline issue" : "Warning"}
          </span>
          <span className="font-mono text-[9px] text-gray-400">
            {event.stage}
          </span>
          <span className="font-mono text-[9px] text-gray-400">
            · {event.code}
          </span>
        </div>
        <div className={cn("mt-0.5", isError ? "text-rose-900" : "text-gray-800")}>
          {event.message}
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="-mr-1 -mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
