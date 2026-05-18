"use client";

// ── Pain metric card ────────────────────────────────────────────────
//
// One card per pain metric. Visualizes the user's progress from
// baseline → current → target with a simple horizontal track that
// makes the gap explicit. Renders the metric name, category chip,
// raw values, and a percent-of-the-way indicator.
//
// Handles BOTH directions:
//   - minimize → target is below baseline (e.g., reduce friction)
//   - maximize → target is above baseline (e.g., improve velocity)
//
// "Reducing" / "growing" copy adapts to direction so the meaning is
// always positive when the metric is moving toward the target.

import { PainIcon, PainReductionIcon } from "@/components/twin/icons/twin-icons";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

type PainMetric = TwinPageBundle["pain_metrics"][number];

interface Props {
  metric: PainMetric;
}

const CATEGORY_LABEL: Record<string, string> = {
  cognitive_fatigue: "Cognitive fatigue",
  time_to_flow: "Time to flow",
  attention_drift: "Attention drift",
  high_cost: "High cost",
  user_friction: "User friction",
  inefficiency: "Inefficiency",
  context_switch_overhead: "Context switching",
  other: "Other",
};

export function TwinPainMetricCard({ metric }: Props) {
  const span = metric.target_value - metric.baseline_value;
  // Progress 0 → 1 representing "how far from baseline toward target."
  // Works for both directions because span carries the sign.
  const progress =
    span === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, (metric.current_value - metric.baseline_value) / span),
        );
  const pct = Math.round(progress * 100);

  // Is the metric trending in the right direction?
  const onTrack =
    metric.direction === "minimize"
      ? metric.current_value < metric.baseline_value
      : metric.current_value > metric.baseline_value;

  // Category lookup with fallback to raw string.
  const catLabel =
    CATEGORY_LABEL[metric.category] ?? metric.category.replace(/_/g, " ");

  return (
    <article
      className="relative flex flex-col rounded-2xl px-6 py-5"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            <PainIcon size={11} />
            {catLabel}
          </div>
          <h3 className="mt-2 line-clamp-2 text-[14.5px] font-semibold leading-snug text-gray-900">
            {metric.name}
          </h3>
        </div>
        <span
          className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
            onTrack
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          <PainReductionIcon size={9} />
          {onTrack ? "On track" : "Off track"}
        </span>
      </div>

      {/* Track + thumb visualization ─────────────────────────────── */}
      <div className="mt-5">
        <div
          className="relative h-2 w-full rounded-full"
          style={{ background: "rgba(15,23,42,0.06)" }}
          aria-label={`Progress: ${pct}%`}
        >
          <span
            className="absolute left-0 top-0 h-full rounded-full transition-[width]"
            style={{
              width: `${pct}%`,
              background: onTrack
                ? "var(--accent-500)"
                : "rgba(245, 158, 11, 0.85)",
            }}
          />
          {/* baseline / target tick marks */}
          <span
            aria-hidden
            className="absolute -top-0.5 left-0 h-3 w-px bg-gray-400"
          />
          <span
            aria-hidden
            className="absolute -top-0.5 right-0 h-3 w-px bg-gray-400"
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10.5px] text-gray-500">
          <span>
            Baseline {fmt(metric.baseline_value)} {metric.unit}
          </span>
          <span className="font-semibold text-gray-700">
            Now {fmt(metric.current_value)} {metric.unit}
          </span>
          <span>
            Target {fmt(metric.target_value)} {metric.unit}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-display-tight text-[24px] font-semibold leading-none text-gray-900">
          {pct}%
        </span>
        <span className="text-[11px] text-gray-500">
          of the way to target
        </span>
      </div>
    </article>
  );
}

// ── Number formatting helper ───────────────────────────────────────
//
// Keep numbers readable — strip trailing zeros, cap at 2 decimals.

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const rounded = Number(n.toFixed(decimals));
  return String(rounded);
}
