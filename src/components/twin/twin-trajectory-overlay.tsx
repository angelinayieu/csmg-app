"use client";

// ── TwinTrajectoryOverlay — the "Trajectory" layer of the Digital Twin ─
//
// Where is the twin heading relative to the active goal? Renders:
//   - Goal title + target metric
//   - Progress bar: baseline → current → target
//   - Gap remaining in absolute terms + percent
//   - Trajectory estimate (weeks to target) when available
//   - Top recommendation as a subtle hint
//
// Empty state: no active goal → "Set a goal to orient the twin." This is
// the same empty-state shape as MainObjectiveBanner, intentionally — user
// keeps seeing the same "set a goal" call-to-action across surfaces.

import { motion } from "framer-motion";
import { useMemo } from "react";
import type { ImprovementGoal } from "@/types/goals";
import type { TwinGoalOverlay } from "@/types/twin";
import type { TwinCardDensity } from "./twin-macro-state-card";

const EASE = [0.22, 1, 0.36, 1] as const;

export interface TwinTrajectoryOverlayProps {
  goal: ImprovementGoal | null;
  /** Optional — when computed already, skip the client-side derivation. */
  overlay?: TwinGoalOverlay | null;
  density?: TwinCardDensity;
  /** Optional click-through to open goal-setter (when no goal set). */
  onSetGoal?: () => void;
  /** Optional click-through to open the goal detail / progress modal. */
  onOpenGoal?: (goal: ImprovementGoal) => void;
}

export function TwinTrajectoryOverlay({
  goal,
  overlay,
  density = "medium",
  onSetGoal,
  onOpenGoal,
}: TwinTrajectoryOverlayProps) {
  // Compute progress metrics. Prefer pre-computed `overlay` if provided
  // (comes from computeTwinState); fall back to raw arithmetic when only
  // the goal row is available (per-app mini case).
  const progress = useMemo(() => {
    if (overlay) {
      return {
        pct: clampPct(overlay.progress_pct),
        gap: overlay.gap_remaining,
        trajectory: overlay.trajectory ?? null,
        topRecommendation: overlay.top_recommendation,
      };
    }
    if (!goal) return null;
    const range = goal.target_value - goal.baseline_value;
    if (!Number.isFinite(range) || range === 0) {
      return { pct: 0, gap: goal.target_value - goal.current_value, trajectory: null, topRecommendation: null };
    }
    const rawPct = ((goal.current_value - goal.baseline_value) / range) * 100;
    return {
      pct: clampPct(rawPct),
      gap: goal.target_value - goal.current_value,
      trajectory: null,
      topRecommendation: null,
    };
  }, [goal, overlay]);

  // ── Empty state: no active goal ──
  if (!goal) {
    return (
      <EmptyGoalShell density={density} onSetGoal={onSetGoal} />
    );
  }

  const showRecommendation = density !== "tight" && progress?.topRecommendation;
  const showTrajectoryEstimate = density !== "tight" && progress?.trajectory;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={`relative overflow-hidden rounded-[18px] border border-white/60 bg-gradient-to-br from-white/85 via-white/70 to-white/55 ${
        density === "tight" ? "px-4 py-3.5" : "px-6 py-5"
      }`}
      style={{
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
      aria-label="Goal trajectory"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-fg,#6b7280)]">
            Trajectory
          </div>
          <h3
            className={`truncate font-semibold tracking-[-0.01em] text-[color:var(--fg,#1d1d1f)] ${
              density === "tight" ? "text-[14px]" : "text-[17px]"
            }`}
          >
            {goal.title}
          </h3>
          {density !== "tight" && goal.metric_name ? (
            <p className="mt-0.5 text-[12px] text-[color:var(--muted-fg,#6b7280)]">
              {goal.metric_name}
              {goal.metric_unit ? ` (${goal.metric_unit})` : ""}
            </p>
          ) : null}
        </div>

        {onOpenGoal ? (
          <button
            type="button"
            onClick={() => onOpenGoal(goal)}
            className="shrink-0 rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-medium text-[color:var(--fg,#1d1d1f)] transition-colors hover:bg-black/10"
          >
            Open goal
          </button>
        ) : null}
      </div>

      {/* Progress bar */}
      {progress ? (
        <div className={density === "tight" ? "mt-3" : "mt-4"}>
          <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-[color:var(--muted-fg,#6b7280)]">
            <span>
              <span className="font-mono font-semibold text-[color:var(--fg,#1d1d1f)]">
                {formatNum(goal.current_value)}
              </span>
              {goal.metric_unit ? ` ${goal.metric_unit}` : ""}
            </span>
            <span>
              target{" "}
              <span className="font-mono font-semibold text-[color:var(--fg,#1d1d1f)]">
                {formatNum(goal.target_value)}
              </span>
              {goal.metric_unit ? ` ${goal.metric_unit}` : ""}
            </span>
          </div>
          <ProgressBar pct={progress.pct} />
          <div className="mt-1 flex items-center justify-between text-[10.5px] text-[color:var(--muted-fg,#86868b)]">
            <span>
              From{" "}
              <span className="font-mono">
                {formatNum(goal.baseline_value)}
              </span>
            </span>
            <span>
              <span className="font-mono font-semibold text-[color:var(--fg,#1d1d1f)]">
                {Math.round(progress.pct)}%
              </span>{" "}
              · gap{" "}
              <span className="font-mono">
                {formatNum(Math.max(0, progress.gap))}
              </span>
            </span>
          </div>
        </div>
      ) : null}

      {/* Trajectory estimate */}
      {showTrajectoryEstimate ? (
        <div
          className="mt-3 flex items-start gap-2.5 rounded-lg border px-3 py-2"
          style={{
            background: "rgba(10,132,255,0.06)",
            borderColor: "rgba(10,132,255,0.18)",
          }}
        >
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ background: "rgba(10,132,255,0.18)" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#0A84FF" }} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#0a4a8f]">
              Estimated timeline
            </div>
            <div className="mt-0.5 text-[12px] font-medium text-[color:var(--fg,#1d1d1f)]">
              {progress?.trajectory?.estimated_weeks ?? "—"} weeks to target
              {progress?.trajectory?.confidence ? (
                <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted-fg,#86868b)]">
                  · {progress.trajectory.confidence} confidence
                </span>
              ) : null}
            </div>
            {progress?.trajectory?.critical_path && progress.trajectory.critical_path.length > 0 ? (
              <div className="mt-1 line-clamp-1 text-[10.5px] text-[color:var(--muted-fg,#86868b)]">
                Critical path: {progress.trajectory.critical_path.slice(0, 3).join(" → ")}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Top recommendation */}
      {showRecommendation && progress?.topRecommendation ? (
        <div className="mt-3 rounded-lg bg-white/50 px-3 py-2 ring-1 ring-white/60">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-fg,#6b7280)]">
            Next best action
          </div>
          <div className="mt-0.5 text-[12.5px] font-medium text-[color:var(--fg,#1d1d1f)]">
            {progress.topRecommendation.title}
          </div>
          {progress.topRecommendation.reasoning ? (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] text-[color:var(--muted-fg,#48484a)]">
              {progress.topRecommendation.reasoning}
            </p>
          ) : null}
        </div>
      ) : null}
    </motion.section>
  );
}

// ── Empty-state shell ────────────────────────────────────────────────

function EmptyGoalShell({
  density,
  onSetGoal,
}: {
  density: TwinCardDensity;
  onSetGoal?: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={`relative overflow-hidden rounded-[18px] border border-dashed border-gray-300/80 bg-white/40 ${
        density === "tight" ? "px-4 py-4" : "px-6 py-6"
      }`}
      style={{
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
      }}
      aria-label="No trajectory yet"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-fg,#6b7280)]">
        Trajectory
      </div>
      <h3
        className={`mt-0.5 font-semibold tracking-[-0.005em] text-[color:var(--fg,#1d1d1f)] ${
          density === "tight" ? "text-[14px]" : "text-[17px]"
        }`}
      >
        No goal anchors the twin yet
      </h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-[color:var(--muted-fg,#6b7280)]">
        The twin renders stages and roles from the KG, but without a goal it
        can&apos;t score trajectory. Set an ultimate goal to orient the twin.
      </p>
      {onSetGoal ? (
        <motion.button
          onClick={onSetGoal}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm transition-all"
          style={{
            background: "linear-gradient(135deg, rgb(var(--accent-rgb)), rgba(var(--accent-rgb), 0.85))",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <circle cx="6" cy="6" r="2" fill="currentColor" />
          </svg>
          Set ultimate goal
        </motion.button>
      ) : null}
    </motion.section>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/5">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          background:
            "linear-gradient(90deg, rgb(var(--accent-rgb)) 0%, rgba(var(--accent-rgb), 0.78) 100%)",
          boxShadow: "0 0 8px rgba(var(--accent-rgb), 0.35)",
        }}
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}
