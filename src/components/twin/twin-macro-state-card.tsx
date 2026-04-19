"use client";

// ── TwinMacroStateCard — the "State" layer of the Digital Twin ────────
//
// Renders the computed TwinMacroState as a compact card: health ring,
// grade, coverage / risk / dynamics breakdown. Density-aware so it plays
// equally well as a dashboard card (tight) and a section on /twin (full).
//
// Distinct from TwinQualityReadout (which measures *whether you should
// trust the twin*). This card answers *what the twin currently says about
// the system*. Two complementary lenses on the same underlying data.

import { motion } from "framer-motion";
import { useMemo } from "react";
import type { TwinMacroState } from "@/types/twin";

const EASE = [0.22, 1, 0.36, 1] as const;

export type TwinCardDensity = "tight" | "medium" | "full";

export interface TwinMacroStateCardProps {
  state: TwinMacroState;
  density?: TwinCardDensity;
  /** Optional click-through — usually routes to `/twin`. */
  onOpen?: () => void;
  /** Title override (default "Twin state"). */
  title?: string;
  /**
   * Twin quality score (0-100) from validateTwinQuality. Renders a small
   * "Quality NN" chip in the header. Distinct from health_score: health
   * tells the user *what the twin says*; quality tells them *whether to
   * trust what the twin says*. When omitted, the chip is hidden.
   */
  qualityScore?: number | null;
  /** Optional click-through on the quality chip — typically opens /twin so
   *  the full TwinQualityReadout is visible. */
  onOpenQuality?: () => void;
}

export function TwinMacroStateCard({
  state,
  density = "medium",
  onOpen,
  title = "Twin state",
  qualityScore,
  onOpenQuality,
}: TwinMacroStateCardProps) {
  const color = scoreColor(state.health_score);
  const gradeText = capitalize(state.health_label);

  const showBreakdown = density !== "tight";
  const showDistributions = density === "full";

  // Derived one-liners
  const summaryLine = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      `${state.coverage.entities_modeled} ${state.coverage.entities_modeled === 1 ? "entity" : "entities"}`
    );
    if (state.dynamics.total_loops > 0) {
      parts.push(
        `${state.dynamics.total_loops} ${state.dynamics.total_loops === 1 ? "loop" : "loops"}`
      );
    }
    if (state.risk_exposure.critical_risks > 0) {
      parts.push(`${state.risk_exposure.critical_risks} critical risk${state.risk_exposure.critical_risks === 1 ? "" : "s"}`);
    }
    return parts.join(" · ");
  }, [state]);

  const bottleneckLabel = state.risk_exposure.bottleneck_name;

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
      aria-label={title}
    >
      {/* Header row — ring + title + optional open-link */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <HealthRing score={state.health_score} color={color} size={density === "tight" ? 46 : 56} />
          <div>
            <div className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-fg,#6b7280)]">
              <span>{title}</span>
              {/* Twin quality chip — surfaces validateTwinQuality.score so
                  the user can tell at a glance whether to trust the twin's
                  numbers. Distinct from health_score. Persisted on every
                  strategy-refresh; recomputed client-side when stale. */}
              {qualityScore != null ? (
                <QualityChip score={qualityScore} onClick={onOpenQuality} />
              ) : null}
            </div>
            <h3
              className={`font-semibold tracking-[-0.01em] text-[color:var(--fg,#1d1d1f)] ${
                density === "tight" ? "text-[15px]" : "text-[18px]"
              }`}
            >
              {gradeText}
            </h3>
            <p className={`mt-0.5 ${density === "tight" ? "text-[11px]" : "text-[12px]"} text-[color:var(--muted-fg,#6b7280)]`}>
              {summaryLine}
            </p>
          </div>
        </div>

        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-medium text-[color:var(--fg,#1d1d1f)] transition-colors hover:bg-black/10"
          >
            Open twin
          </button>
        ) : null}
      </div>

      {/* Breakdown row — 3 sub-metrics. `density` is already narrowed to
          "medium" | "full" here because showBreakdown excluded "tight". */}
      {showBreakdown ? (
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <SubMetric
            label="Coverage"
            value={`${Math.round((1 - state.coverage.orphan_ratio) * 100)}%`}
            detail={`${state.coverage.entities_modeled} · ${state.coverage.edges_mapped} edges`}
            accent="rgb(var(--accent-rgb))"
          />
          <SubMetric
            label="Risk"
            value={state.risk_exposure.critical_risks > 0
              ? `${state.risk_exposure.critical_risks} critical`
              : state.risk_exposure.total_risk_points > 0
                ? `${state.risk_exposure.total_risk_points} tracked`
                : "Clear"
            }
            detail={
              bottleneckLabel
                ? `Bottleneck: ${bottleneckLabel}`
                : state.risk_exposure.max_blast_radius > 0
                  ? `Max blast ${state.risk_exposure.max_blast_radius}`
                  : undefined
            }
            accent={state.risk_exposure.critical_risks > 0 ? "#FF453A" : "#30D158"}
          />
          <SubMetric
            label="Dynamics"
            value={
              state.dynamics.total_loops > 0
                ? `${state.dynamics.total_loops} ${state.dynamics.total_loops === 1 ? "loop" : "loops"}`
                : "Linear"
            }
            detail={
              state.dynamics.leverage_points > 0
                ? `${state.dynamics.leverage_points} leverage`
                : undefined
            }
            accent="#AF52DE"
          />
        </div>
      ) : null}

      {/* Distribution row — confidence + source (only in full density) */}
      {showDistributions ? (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/50 pt-3.5">
          <DistributionBar
            label="Confidence"
            values={[
              { label: "High", value: state.coverage.confidence_distribution.high, color: "#30D158" },
              { label: "Medium", value: state.coverage.confidence_distribution.medium, color: "#FF9F0A" },
              { label: "Low", value: state.coverage.confidence_distribution.low, color: "#FF453A" },
            ]}
          />
          <DistributionBar
            label="Source"
            values={[
              { label: "Explicit", value: state.coverage.source_distribution.explicit, color: "rgb(var(--accent-rgb))" },
              { label: "Implicit", value: state.coverage.source_distribution.implicit, color: "#AF52DE" },
              { label: "Assumed", value: state.coverage.source_distribution.assumed, color: "#86868B" },
            ]}
          />
        </div>
      ) : null}

      {/* Footer — maturity + last updated (only in medium/full) */}
      {density !== "tight" ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/50 pt-2.5 text-[11px] text-[color:var(--muted-fg,#86868b)]">
          <span>
            Maturity:{" "}
            <span className="font-semibold text-[color:var(--fg,#1d1d1f)]">
              {state.maturity.replace(/_/g, " ")}
            </span>
          </span>
          {state.last_updated ? (
            <span>Updated {formatAgo(state.last_updated)}</span>
          ) : null}
        </div>
      ) : null}
    </motion.section>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function HealthRing({
  score,
  color,
  size,
}: {
  score: number;
  color: string;
  size: number;
}) {
  const strokeW = size >= 52 ? 5 : 4;
  const r = (size - strokeW) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(0,0,0,0.08)" strokeWidth={strokeW} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: EASE }}
          style={{ filter: `drop-shadow(0 0 4px ${color}60)` }}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[17px] font-semibold tabular-nums text-[color:var(--fg,#1d1d1f)]">
          {Math.round(score)}
        </span>
        <span className="mt-0.5 text-[8px] font-medium uppercase tracking-wide text-[color:var(--muted-fg,#86868b)]">
          /100
        </span>
      </span>
    </div>
  );
}

function QualityChip({
  score,
  onClick,
}: {
  score: number;
  onClick?: () => void;
}) {
  const color = qualityColor(score);
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={`Twin quality ${Math.round(score)}/100 — measures whether to trust the twin (distinct from health)`}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide normal-case transition-opacity ${
        onClick ? "cursor-pointer hover:opacity-80" : "cursor-default"
      }`}
      style={{
        background: `${color}1A`,
        color,
        border: `1px solid ${color}33`,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: color }}
      />
      <span className="font-mono">Quality {Math.round(score)}</span>
    </Tag>
  );
}

function SubMetric({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail?: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/50 bg-white/40 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="h-[5px] w-[5px] rounded-full" style={{ background: accent, boxShadow: `0 0 4px ${accent}80` }} />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted-fg,#6b7280)]">
          {label}
        </span>
      </div>
      <div className="mt-1 text-[13px] font-semibold text-[color:var(--fg,#1d1d1f)]">{value}</div>
      {detail ? (
        <div className="mt-0.5 line-clamp-1 text-[10.5px] text-[color:var(--muted-fg,#86868b)]">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function DistributionBar({
  label,
  values,
}: {
  label: string;
  values: Array<{ label: string; value: number; color: string }>;
}) {
  const total = values.reduce((s, v) => s + v.value, 0);
  if (total === 0) {
    return (
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted-fg,#6b7280)]">
          {label}
        </div>
        <div className="text-[11px] text-[color:var(--muted-fg,#86868b)]">No data.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted-fg,#6b7280)]">
        <span>{label}</span>
        <span className="font-mono normal-case tracking-normal text-[color:var(--muted-fg,#86868b)]">
          {total}
        </span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-black/5">
        {values.map((v, i) =>
          v.value === 0 ? null : (
            <motion.div
              key={`${v.label}-${i}`}
              initial={{ width: 0 }}
              animate={{ width: `${(v.value / total) * 100}%` }}
              transition={{ duration: 0.6, ease: EASE, delay: i * 0.08 }}
              style={{ background: v.color }}
              className="h-full"
              title={`${v.label}: ${v.value}`}
            />
          )
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[color:var(--muted-fg,#86868b)]">
        {values.map((v) => (
          <span key={v.label} className="flex items-center gap-1">
            <span className="h-[5px] w-[5px] rounded-full" style={{ background: v.color }} />
            <span>
              {v.label} · <span className="font-mono font-semibold text-[color:var(--fg,#1d1d1f)]">{v.value}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 85) return "#30D158";
  if (score >= 70) return "rgb(var(--accent-rgb))";
  if (score >= 50) return "#FF9F0A";
  return "#FF453A";
}

// Quality chip uses the TwinQualityReport thresholds (>=60 passing) so the
// palette differs slightly from health's: 60 is "fair", not "fragile".
function qualityColor(score: number): string {
  if (score >= 90) return "#30D158";
  if (score >= 70) return "#0A84FF";
  if (score >= 60) return "#FF9F0A";
  if (score >= 40) return "#FF9500";
  return "#FF453A";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const deltaMs = Date.now() - then;
  const mins = Math.round(deltaMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
