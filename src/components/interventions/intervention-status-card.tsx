"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  MoreHorizontal,
  Clock,
  CheckCircle2,
  MinusCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Wave D L1.2 — InterventionStatusCard.
 *
 * A reusable, state-aware card for one intervention. Three visual
 * variants keyed to `status`:
 *
 *   proposed|active  → interactive, shows Complete + Abandon buttons,
 *                      elevated glass, subtle breathing animation
 *   completed        → collapsed tile with green check, reduced opacity
 *   abandoned        → collapsed tile with muted minus-circle, strike
 *
 * Uses Framer Motion `layout` + AnimatePresence so state transitions
 * morph the card shape rather than hard-switching — gives the
 * visionOS-style fluidity where interventions "settle" into their
 * resolved form.
 *
 * Apple Vision Pro vibes:
 *   - backdrop-blur glass + inset highlight on the interactive variant
 *   - subtle translateZ on hover (`preserve-3d` assumed on the parent
 *     grid; falls back gracefully if not)
 *   - spring physics on morphs (duration 0.35, ease [0.22, 1, 0.36, 1])
 *   - no harsh colors — amber for abandoned, green for completed, both
 *     desaturated to feel soft
 */

interface InterventionStatusCardProps {
  intervention: {
    id: string;
    title: string;
    description?: string | null;
    status: "proposed" | "active" | "completed" | "superseded" | "abandoned";
    priority?: number | null;
    effort?: string | null;
    impact?: string | null;
    timeframe?: string | null;
    metric_name?: string | null;
    metric_target?: string | null;
  };
  /** Fired after a successful complete — parent can update its list. */
  onResolved?: (args: {
    id: string;
    new_status: "completed" | "abandoned";
    app_health_after: number | null;
  }) => void;
}

export function InterventionStatusCard({
  intervention,
  onResolved,
}: InterventionStatusCardProps) {
  const [optimisticStatus, setOptimisticStatus] = useState(intervention.status);
  const [submitting, setSubmitting] = useState<
    null | "completing" | "abandoning"
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [showAbandonPrompt, setShowAbandonPrompt] = useState(false);
  const [abandonNote, setAbandonNote] = useState("");

  const isResolvedTerminal =
    optimisticStatus === "completed" ||
    optimisticStatus === "abandoned" ||
    optimisticStatus === "superseded";

  async function resolve(
    endpoint: "complete" | "abandon",
    note: string | null,
  ) {
    setSubmitting(endpoint === "complete" ? "completing" : "abandoning");
    setError(null);
    try {
      const res = await fetch(
        `/api/interventions/${intervention.id}/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(note ? { note } : {}),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        new_status: "completed" | "abandoned";
        app_health_after: number | null;
      };
      setOptimisticStatus(body.new_status);
      onResolved?.({
        id: intervention.id,
        new_status: body.new_status,
        app_health_after: body.app_health_after,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolution failed");
    } finally {
      setSubmitting(null);
      setShowAbandonPrompt(false);
      setAbandonNote("");
    }
  }

  // ── Collapsed (resolved) variant ──
  if (isResolvedTerminal) {
    const isCompleted = optimisticStatus === "completed";
    return (
      <motion.div
        layout
        initial={{ opacity: 0.7, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[12px]",
          isCompleted
            ? "border-green-200/60 bg-green-50/50 text-green-900"
            : "border-gray-200/60 bg-gray-50/40 text-gray-500",
        )}
      >
        {isCompleted ? (
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-green-600" />
        ) : (
          <MinusCircle className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
        )}
        <span
          className={cn(
            "flex-1 truncate font-medium",
            !isCompleted && "line-through decoration-gray-300",
          )}
        >
          {intervention.title}
        </span>
        <span className="flex-shrink-0 text-[10px] uppercase tracking-widest opacity-75">
          {optimisticStatus}
        </span>
      </motion.div>
    );
  }

  // ── Interactive (proposed / active) variant ──
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="group relative overflow-hidden rounded-xl border border-gray-200/60 bg-white/60 p-3 backdrop-blur-sm transition-shadow hover:shadow-[0_6px_24px_rgba(0,0,0,0.05)]"
      style={{
        // visionOS-ish inset highlight
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
      }}
    >
      {/* Subtle accent gradient on hover — barely visible until focus */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(135deg, rgba(var(--accent-rgb), 0.04), rgba(var(--accent-rgb), 0))",
        }}
        aria-hidden
      />

      <div className="relative flex items-start gap-2.5">
        <div className="mt-0.5 flex-shrink-0">
          <div
            className={cn(
              "h-5 w-5 rounded-full ring-1 ring-inset",
              optimisticStatus === "active"
                ? "bg-interaxis-50 ring-interaxis-200"
                : "bg-gray-50 ring-gray-200",
            )}
          >
            <Clock
              className={cn(
                "h-full w-full p-1",
                optimisticStatus === "active"
                  ? "text-interaxis-600"
                  : "text-gray-400",
              )}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-gray-900">
            {intervention.title}
          </div>
          {intervention.description && (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] text-gray-600">
              {intervention.description}
            </p>
          )}
          {/* Metric strip */}
          {(intervention.metric_name || intervention.metric_target) && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-gray-100/70 px-2 py-0.5 text-[10px] text-gray-600">
              <span className="font-semibold uppercase tracking-wider">
                Target
              </span>
              <span>
                {intervention.metric_name}
                {intervention.metric_target
                  ? ` → ${intervention.metric_target}`
                  : ""}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            onClick={() => resolve("complete", null)}
            disabled={submitting !== null}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              "text-green-600 hover:bg-green-50",
              submitting && "cursor-not-allowed opacity-50",
            )}
            title="Mark complete"
            aria-label="Mark complete"
          >
            {submitting === "completing" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => setShowAbandonPrompt(true)}
            disabled={submitting !== null}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              "text-gray-400 hover:bg-gray-100 hover:text-gray-700",
              submitting && "cursor-not-allowed opacity-50",
            )}
            title="Abandon"
            aria-label="Abandon"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 opacity-0 transition-all hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100"
            title="More"
            aria-label="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Abandon reason prompt — slides in from below */}
      <AnimatePresence>
        {showAbandonPrompt && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative mt-2 overflow-hidden rounded-lg border border-amber-200/60 bg-amber-50/40 p-2.5"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              Reason (optional, recommended)
            </div>
            <textarea
              value={abandonNote}
              onChange={(e) => setAbandonNote(e.target.value)}
              rows={2}
              placeholder="Why are you abandoning this? The system learns from your reasons."
              className="mt-1.5 w-full resize-none rounded-md border border-amber-200 bg-white px-2 py-1 text-[11.5px] placeholder-gray-400 focus:border-amber-400 focus:outline-none"
              maxLength={500}
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                onClick={() => {
                  setShowAbandonPrompt(false);
                  setAbandonNote("");
                }}
                className="rounded px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => resolve("abandon", abandonNote || null)}
                disabled={submitting !== null}
                className="rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200 disabled:opacity-50"
              >
                {submitting === "abandoning" ? "Abandoning…" : "Confirm abandon"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="mt-2 text-[11px] text-red-600">{error}</div>
      )}
    </motion.div>
  );
}
