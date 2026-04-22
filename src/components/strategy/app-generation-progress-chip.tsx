"use client";

// ── App generation progress chip (MVP conversational approval) ──
//
// After the user confirms a strategy, the backend materializes apps
// synchronously but writes progress into synthesis_data.app_generation_progress.
// This chip polls GET /api/apps/generation-progress?spaceId=X and renders a
// compact "Building apps (N of M ready)" indicator that the user can see on
// the dashboard while generation completes.
//
// Apple-Vision-Pro aesthetic: glass backdrop, single accent color, minimal
// motion (a subtle pulse on the progress ring when running).

import React, { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface ProgressPayload {
  status: "idle" | "running" | "complete" | "failed";
  completed_count: number;
  expected_count: number;
  apps_ready: number;
  apps_created?: number;
  apps_updated?: number;
  started_at?: string;
  completed_at?: string;
  last_updated?: string;
}

interface Props {
  spaceId: string;
  /** Poll interval ms; defaults to 2500ms while running, 0 (stopped) when terminal */
  pollIntervalMs?: number;
  /** Called when status transitions to "complete" — useful for triggering a dashboard refresh */
  onComplete?: () => void;
  /** Optional className for the outer chip */
  className?: string;
}

export function AppGenerationProgressChip({ spaceId, pollIntervalMs = 2500, onComplete, className }: Props) {
  const reducedMotion = useReducedMotion();
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastStatus: string | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/apps/generation-progress?spaceId=${encodeURIComponent(spaceId)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProgressPayload;
        if (cancelled) return;
        setProgress(data);
        setLoading(false);

        if (data.status === "complete" && lastStatus !== "complete") {
          onCompleteRef.current?.();
        }
        lastStatus = data.status;

        // Continue polling while running; otherwise stop.
        if (data.status === "running") {
          timer = setTimeout(poll, pollIntervalMs);
        }
      } catch {
        if (cancelled) return;
        // Retry with backoff on error
        timer = setTimeout(poll, pollIntervalMs * 2);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [spaceId, pollIntervalMs]);

  // Don't render when idle (no generation has started yet)
  if (loading) return null;
  if (!progress || progress.status === "idle") return null;

  const pct = progress.expected_count > 0
    ? Math.min(100, Math.round((progress.completed_count / progress.expected_count) * 100))
    : progress.status === "complete" ? 100 : 0;

  const isRunning = progress.status === "running";
  const isComplete = progress.status === "complete";
  const isFailed = progress.status === "failed";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border bg-white/70 backdrop-blur-xl px-3 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] text-[11px]",
        isRunning && "border-indigo-200",
        isComplete && "border-green-200",
        isFailed && "border-red-200",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {/* Status icon */}
      {isRunning && <Loader2 className={cn("h-3 w-3 text-indigo-500", !reducedMotion && "animate-spin")} />}
      {isComplete && <CheckCircle2 className="h-3 w-3 text-green-600" />}
      {isFailed && <AlertCircle className="h-3 w-3 text-red-500" />}

      {/* Label + count */}
      <span className="text-gray-700">
        {isRunning && (
          <>
            <span className="font-semibold">Building apps</span>
            <span className="ml-1 tabular-nums text-gray-500">
              {progress.apps_ready} of {progress.expected_count} ready
            </span>
          </>
        )}
        {isComplete && (
          <>
            <span className="font-semibold text-green-700">Apps ready</span>
            <span className="ml-1 tabular-nums text-gray-500">
              {progress.apps_ready} live
              {progress.apps_created ? ` · ${progress.apps_created} new` : ""}
            </span>
          </>
        )}
        {isFailed && (
          <>
            <span className="font-semibold text-red-700">App generation failed</span>
            <span className="ml-1 text-gray-500">— retry strategy confirm</span>
          </>
        )}
      </span>

      {/* Progress bar (only while running) */}
      {isRunning && progress.expected_count > 0 && (
        <div className="relative h-1 w-16 rounded-full bg-indigo-50 overflow-hidden">
          <div
            className={cn("absolute inset-y-0 left-0 bg-indigo-500 rounded-full", !reducedMotion && "transition-[width] duration-500")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
