"use client";

/**
 * Main Objective Banner — the hero at the top of the per-project dashboard.
 *
 * Surfaces the three pieces the user needs to see first every time they open a space:
 *   1. Subject        — what this project is modeling (the space name / input)
 *   2. Ultimate Goal  — the active improvement_goal, with its metric target
 *   3. Twin State     — the computed health readout, separate from Subject
 *
 * Visual: Vision-Pro-style glass hero panel with specular rim + shimmer.
 */

import { motion } from "framer-motion";
import { useSpaceData } from "@/contexts/space-data-context";
import { useMemo } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

export function MainObjectiveBanner() {
  const { space, activeGoal, liveCounts, setShowGoalSetter } = useSpaceData();

  // Compute a lightweight "twin state" summary right here so the banner is self-sufficient.
  // The detailed computation lives elsewhere; this just pulls the headline.
  const twin = useMemo(() => {
    const synth = (space?.synthesis_data as Record<string, unknown> | null) ?? null;
    const twinState = (synth?.twin_state ?? null) as Record<string, unknown> | null;
    const health = typeof twinState?.health_score === "number" ? twinState.health_score : null;
    const label = typeof twinState?.health_label === "string" ? twinState.health_label : null;
    const coverage = typeof (twinState?.coverage as { pct?: number } | undefined)?.pct === "number"
      ? (twinState?.coverage as { pct: number }).pct
      : null;
    return { health, label, coverage };
  }, [space]);

  const subjectTitle = space?.name ?? "Untitled subject";
  const subjectDesc = space?.description || trimSentence(space?.input_text ?? "", 180);

  const goalTitle = activeGoal?.title ?? "No goal set";
  const goalMetric = activeGoal?.metric_name;
  const baselineVal = activeGoal ? activeGoal.baseline_value : null;
  const targetVal = activeGoal ? activeGoal.target_value : null;
  const currentVal = activeGoal ? activeGoal.current_value : null;
  const metricUnit = activeGoal?.metric_unit ?? "";

  // Progress toward goal, if numbers are meaningful
  const progressPct = useMemo(() => {
    if (baselineVal == null || targetVal == null || currentVal == null) return null;
    if (targetVal === baselineVal) return null;
    const pct = ((currentVal - baselineVal) / (targetVal - baselineVal)) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [baselineVal, targetVal, currentVal]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="glass-hero relative overflow-hidden rounded-[22px] px-8 py-7"
      aria-label="Project main objective"
    >
      {/* Top label strip */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-[6px] w-[6px] rounded-full"
            style={{ background: "rgb(var(--accent-rgb))", boxShadow: "0 0 12px rgb(var(--accent-rgb))" }}
          />
          <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
            Main Objective
          </span>
        </div>
        <TwinChip health={twin.health} label={twin.label} coverage={twin.coverage} />
      </div>

      {/* Content grid: Subject | Ultimate Goal */}
      <div className="grid grid-cols-[1.4fr_1fr] gap-10">
        {/* Subject */}
        <div className="min-w-0">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide uppercase text-[color:var(--muted-fg,#6b7280)]">
            Subject
          </div>
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-0.01em] text-[color:var(--fg,#1d1d1f)]">
            {subjectTitle}
          </h1>
          {subjectDesc ? (
            <p className="mt-2 line-clamp-2 text-[14px] leading-[1.5] text-[color:var(--muted-fg,#48484a)]">
              {subjectDesc}
            </p>
          ) : null}

          {/* Micro-stats strip */}
          <div className="mt-4 flex items-center gap-4 text-[12px] text-[color:var(--muted-fg,#6b7280)]">
            <Stat label="Entities" value={liveCounts.entities} />
            <Dot />
            <Stat label="Edges" value={liveCounts.edges} />
            <Dot />
            <Stat label="Cycles" value={liveCounts.cycles} />
          </div>
        </div>

        {/* Ultimate Goal */}
        <div className="min-w-0 border-l border-white/40 pl-10">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide uppercase text-[color:var(--muted-fg,#6b7280)]">
            Ultimate Goal
          </div>
          <h2 className="truncate text-[20px] font-semibold leading-tight tracking-[-0.005em] text-[color:var(--fg,#1d1d1f)]">
            {goalTitle}
          </h2>

          {activeGoal ? (
            <>
              {goalMetric ? (
                <p className="mt-1 text-[13px] text-[color:var(--muted-fg,#48484a)]">
                  <span className="font-medium">{goalMetric}</span>
                  {targetVal != null ? (
                    <>
                      {" — target "}
                      <span className="font-mono font-medium">
                        {formatNum(targetVal)}
                        {metricUnit ? ` ${metricUnit}` : ""}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}

              {progressPct != null ? (
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-[color:var(--muted-fg,#6b7280)]">
                    <span>Progress</span>
                    <span className="font-mono font-medium text-[color:var(--fg,#1d1d1f)]">
                      {formatNum(currentVal ?? 0)} / {formatNum(targetVal ?? 0)}
                    </span>
                  </div>
                  <ProgressBar pct={progressPct} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-[color:var(--muted-fg,#86868b)]">
                Set an ultimate goal to anchor this project.
              </p>
              <motion.button
                onClick={() => setShowGoalSetter(true)}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.2, ease: EASE }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-md transition-all"
                style={{
                  background:
                    "linear-gradient(135deg, rgb(var(--accent-rgb)), rgba(var(--accent-rgb), 0.85))",
                  boxShadow:
                    "0 4px 12px rgba(var(--accent-rgb), 0.3), 0 1px 0 rgba(255,255,255,0.4) inset",
                }}
                aria-label="Set an ultimate goal for this project"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3" fill="none" />
                  <circle cx="6" cy="6" r="2" fill="currentColor" />
                </svg>
                Set ultimate goal
              </motion.button>
            </>
          )}
        </div>
      </div>
    </motion.section>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────

function TwinChip({
  health,
  label,
  coverage,
}: {
  health: number | null;
  label: string | null;
  coverage: number | null;
}) {
  if (health == null && !label) {
    return (
      <div className="rounded-full bg-white/30 px-3 py-1 text-[11px] font-medium text-[color:var(--muted-fg,#86868b)] backdrop-blur-md">
        Twin — not initialized
      </div>
    );
  }
  return (
    <motion.div
      className="flex items-center gap-2 rounded-full border border-white/50 bg-white/40 px-3 py-1 backdrop-blur-md"
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="6.5" stroke="rgba(0,0,0,0.08)" strokeWidth="1.5" fill="none" />
        {health != null ? (
          <circle
            cx="8"
            cy="8"
            r="6.5"
            stroke="rgb(var(--accent-rgb))"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(health / 100) * 40.84} 40.84`}
            transform="rotate(-90 8 8)"
          />
        ) : null}
      </svg>
      <span className="text-[11px] font-semibold text-[color:var(--fg,#1d1d1f)]">
        Twin · {health != null ? `${Math.round(health)}%` : "—"}
      </span>
      {coverage != null ? (
        <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
          · {Math.round(coverage)}% covered
        </span>
      ) : null}
      {label ? (
        <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">· {label}</span>
      ) : null}
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono font-semibold text-[color:var(--fg,#1d1d1f)]">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function Dot() {
  return <span className="h-[3px] w-[3px] rounded-full bg-current opacity-30" />;
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/40">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.2 }}
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          background:
            "linear-gradient(90deg, rgb(var(--accent-rgb)) 0%, rgba(var(--accent-rgb), 0.7) 100%)",
          boxShadow: "0 0 8px rgba(var(--accent-rgb), 0.5)",
        }}
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function trimSentence(s: string, max: number): string {
  if (!s) return "";
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}
