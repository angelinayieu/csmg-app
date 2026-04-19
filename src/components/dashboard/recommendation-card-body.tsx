"use client";

import { cn } from "@/lib/utils";
import { formatTimeAgo, isFreshlyGenerated } from "@/lib/utils/format-time";

/**
 * Compact proposal card body rendered inside the "#1 Recommendation"
 * GlassCard slot on the per-project dashboard (~315px wide).
 *
 * Surfaces the highest-signal pieces of the strategy:
 *   - Title + one-line summary (explains what the strategy is)
 *   - Confidence ring
 *   - Impact / Risk / ROI metrics
 *   - Top perspective (from BSC) with its key-metric progress
 *   - Evidence-grounding strip (atoms · chains · entities)
 *   - Freshness + approve control
 *
 * Keeps the parent <Link> navigation to /strategy intact — inner Approve
 * button uses stopPropagation.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseRec = Record<string, any>;

interface Props {
  strategicRec: LooseRec;
  approved: boolean;
  rankedCount?: number;
  onApprove?: () => void;
}

/** Normalize an unknown "impact" field into a display string. */
function formatImpact(raw: unknown): { label: string; cls: string } {
  if (raw === null || raw === undefined) {
    return { label: "—", cls: "text-[#6b7280]" };
  }

  let str: string;
  if (typeof raw === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = raw as any;
    const value = obj.value ?? obj.delta ?? obj.amount ?? obj.number;
    const unit = obj.unit ?? obj.suffix ?? obj.metric_unit ?? "";
    const direction: string = String(obj.direction ?? "").toLowerCase();

    if (value === undefined || value === null) {
      const fallback = obj.label ?? obj.metric ?? obj.name;
      if (typeof fallback === "string") {
        str = fallback;
      } else {
        return { label: "—", cls: "text-[#6b7280]" };
      }
    } else {
      const valueStr = typeof value === "number" ? value.toString() : String(value);
      const sign =
        direction === "decrease" || direction === "down" || direction === "reduce"
          ? valueStr.startsWith("-") || valueStr.startsWith("−")
            ? ""
            : "−"
          : direction === "increase" || direction === "up" || direction === "grow"
            ? "+"
            : "";
      str = `${sign}${valueStr}${unit}`;
    }
  } else if (typeof raw === "number") {
    str = raw.toString();
  } else {
    str = String(raw).trim();
  }

  if (!str || str === "undefined" || str === "null") {
    return { label: "—", cls: "text-[#6b7280]" };
  }

  const trimmed = str.length > 11 ? str.slice(0, 10) + "…" : str;
  const isImprovement = /^[-−]/.test(str);
  return {
    label: trimmed,
    cls: isImprovement ? "text-[#059669]" : "text-[#0a1020]",
  };
}

/** Compute a 0-100 progress estimate for a perspective's key metric. */
function estimatePerspectiveProgress(perspective: LooseRec): number {
  // Prefer explicit contribution_to_health if present
  const contrib = perspective.key_metric?.contribution_to_health;
  if (typeof contrib === "number" && contrib >= 0 && contrib <= 100) {
    return Math.round(contrib);
  }
  // Fall back to confidence mapping
  const conf = perspective.confidence;
  if (conf === "high") return 75;
  if (conf === "moderate") return 45;
  if (conf === "low") return 20;
  return 35;
}

/** Truncate text safely for 1-line display. */
function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export function RecommendationCardBody({
  strategicRec,
  approved,
  rankedCount = 1,
  onApprove,
}: Props) {
  const inner: LooseRec = strategicRec.recommendation ?? strategicRec;
  const generatedAt: string | null =
    (strategicRec.generated_at as string | undefined) ??
    (inner.generated_at as string | undefined) ??
    null;

  const title: string = inner.title ?? inner.headline ?? "Strategy ready";
  const summary: string | null = inner.summary ?? inner.description ?? null;

  const confidence: number =
    typeof inner.confidence === "number"
      ? inner.confidence > 1
        ? Math.round(inner.confidence)
        : Math.round(inner.confidence * 100)
      : 50;

  // Risk derived from strategic_posture taxonomy
  const posture = (inner.strategic_posture as string) ?? "";
  const risk =
    posture === "aggressive_growth"
      ? { label: "Medium", cls: "text-[#d97706]" }
      : posture === "pivot_exploration"
        ? { label: "High", cls: "text-[#dc2626]" }
        : posture === "cautious_validation" || posture === "consolidation"
          ? { label: "Low", cls: "text-[#059669]" }
          : posture === "defensive"
            ? { label: "Low", cls: "text-[#059669]" }
            : { label: "—", cls: "text-[#6b7280]" };

  const impact = formatImpact(
    inner.target_objective?.expected_delta ??
      inner.target_objective?.delta ??
      inner.perspectives?.[0]?.key_metric ??
      null
  );

  const roi: string =
    (inner.temporal_phases?.[0]?.milestone as string | undefined) ??
    (inner.temporal_phases?.[0]?.target_date as string | undefined) ??
    (inner.temporal_phases?.[0]?.label as string | undefined) ??
    "—";

  // Top BSC perspective (if present)
  const topPerspective: LooseRec | null = Array.isArray(inner.perspectives) && inner.perspectives.length > 0
    ? inner.perspectives[0]
    : null;
  const perspectiveProgress = topPerspective ? estimatePerspectiveProgress(topPerspective) : 0;
  const perspectiveMetricName =
    topPerspective?.key_metric?.name ??
    topPerspective?.objective ??
    null;
  const perspectiveTrend = topPerspective?.key_metric?.trend_delta ?? null;

  // Evidence grounding counts
  const atomCount: number | null =
    typeof inner.strategy_layers?.l4_atomic_insights?.length === "number"
      ? inner.strategy_layers.l4_atomic_insights.length
      : typeof inner.entity_references?.length === "number"
        ? inner.entity_references.length
        : null;
  const chainCount: number | null =
    Array.isArray(inner.strategy_layers?.l3_reasoning_units)
      ? inner.strategy_layers.l3_reasoning_units.length
      : Array.isArray(inner.key_decision?.supporting_entities)
        ? inner.key_decision.supporting_entities.length
        : null;
  const externalCount: number | null =
    typeof inner.external_evidence_count === "number"
      ? inner.external_evidence_count
      : null;

  const isNew = isFreshlyGenerated(generatedAt, 24) && !approved;
  const updatedLabel = generatedAt ? formatTimeAgo(generatedAt) : null;

  const ringColor =
    confidence >= 75 ? "#059669" : confidence >= 50 ? "#d97706" : "#dc2626";
  const ringDash = 125.66;
  const ringOffset = ringDash * (1 - confidence / 100);

  const qualitySignals: Record<string, boolean> = inner.quality_signals ?? {};
  const groundedCount = [
    qualitySignals.grounded_in_data,
    qualitySignals.external_validated,
    qualitySignals.risk_addressed,
    qualitySignals.temporal_aware,
    qualitySignals.objective_targeted,
  ].filter(Boolean).length;

  const handleApprove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onApprove?.();
  };

  const showBadges = rankedCount > 1 || isNew || approved;

  return (
    <div className="relative z-[1] mt-3 flex flex-col gap-2.5">
      {/* ── Title + summary + ring ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {showBadges && (
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              {rankedCount > 1 && (
                <span className="inline-flex items-center gap-1 rounded-[5px] bg-[#0a1020] text-white text-[9.5px] font-semibold tracking-wide px-1.5 py-[3px]">
                  <svg viewBox="0 0 14 14" fill="currentColor" className="w-[9px] h-[9px]">
                    <path d="M2 11l1-6 2.5 3L7 4l1.5 4L11 5l1 6z" />
                  </svg>
                  #1 of {rankedCount}
                </span>
              )}
              {isNew && (
                <span className="inline-flex items-center gap-1 rounded-[5px] bg-green-50 border border-green-200 text-green-700 text-[9.5px] font-semibold tracking-wide px-1.5 py-[3px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  NEW
                </span>
              )}
              {approved && !isNew && (
                <span className="inline-flex items-center gap-1 rounded-[5px] bg-green-50 border border-green-200 text-green-700 text-[9.5px] font-semibold tracking-wide px-1.5 py-[3px]">
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[9px] h-[9px]">
                    <path d="M2.5 6l2.5 2.5 4.5-4.5" />
                  </svg>
                  Approved
                </span>
              )}
            </div>
          )}
          <p className="text-[13px] font-bold text-[#0a1020] leading-[1.3] tracking-[-0.01em] line-clamp-2">
            {title}
          </p>
          {summary && (
            <p className="text-[11px] text-[#6b7280] leading-[1.45] mt-1 line-clamp-2">
              {truncate(summary, 140)}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center flex-shrink-0">
          <div className="relative w-[40px] h-[40px]">
            <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
              <circle cx="24" cy="24" r="20" fill="none" stroke="#eef2f8" strokeWidth="3.5" />
              <circle
                cx="24"
                cy="24"
                r="20"
                fill="none"
                stroke={ringColor}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={ringDash}
                strokeDashoffset={ringOffset}
                style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-[#0a1020] tabular-nums">
              {confidence}
            </div>
          </div>
          <div className="text-[8.5px] font-semibold text-[#8592a8] tracking-wider uppercase mt-0.5">
            Conf
          </div>
        </div>
      </div>

      {/* ── 3-metric grid ── */}
      <div className="grid grid-cols-3 rounded-[8px] border border-black/[0.06] overflow-hidden bg-white/40">
        <div className="px-1.5 py-1.5 text-center border-r border-black/[0.06] min-w-0">
          <div className="text-[9px] font-medium text-[#8592a8] tracking-wide uppercase">Impact</div>
          <div className={cn("text-[12px] font-semibold tabular-nums leading-tight mt-0.5 truncate", impact.cls)}>
            {impact.label}
          </div>
        </div>
        <div className="px-1.5 py-1.5 text-center border-r border-black/[0.06] min-w-0">
          <div className="text-[9px] font-medium text-[#8592a8] tracking-wide uppercase">Risk</div>
          <div className={cn("text-[12px] font-semibold leading-tight mt-0.5 truncate", risk.cls)}>
            {risk.label}
          </div>
        </div>
        <div className="px-1.5 py-1.5 text-center min-w-0">
          <div className="text-[9px] font-medium text-[#8592a8] tracking-wide uppercase">ROI</div>
          <div className="text-[12px] font-semibold text-[#0a1020] tabular-nums leading-tight mt-0.5 truncate">
            {roi}
          </div>
        </div>
      </div>

      {/* ── Top perspective (mini-cascade row) ── */}
      {topPerspective && perspectiveMetricName && (
        <div className="flex flex-col gap-1 rounded-[8px] bg-white/40 border border-black/[0.06] px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 min-w-0">
              {topPerspective.icon && (
                <span className="text-[13px] leading-none flex-shrink-0">{topPerspective.icon}</span>
              )}
              <span className="text-[10.5px] font-semibold text-[#374151] truncate">
                {truncate(topPerspective.name, 18)}
              </span>
            </span>
            {perspectiveTrend && (
              <span className="text-[10.5px] font-semibold text-[#059669] tabular-nums whitespace-nowrap flex-shrink-0">
                {perspectiveTrend}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#1f2937] leading-snug line-clamp-1">
            {truncate(perspectiveMetricName, 44)}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex-1 h-1 rounded-full bg-[#eef2f8] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${perspectiveProgress}%`,
                  background: "linear-gradient(90deg, #0051ff, #059669)",
                  transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
                }}
              />
            </div>
            <span className="text-[10px] font-semibold text-[#6b7280] tabular-nums flex-shrink-0">
              {perspectiveProgress}%
            </span>
          </div>
        </div>
      )}

      {/* ── Evidence grounding strip ── */}
      {(atomCount !== null || chainCount !== null || externalCount !== null || groundedCount > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-medium text-[#6b7280]">
          <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5 text-[#0051ff] flex-shrink-0">
            <path d="M6 1l1.2 3.4H11L8.1 6.6l1.1 3.4L6 7.9 2.8 10l1.1-3.4L1 4.4h3.8z" />
          </svg>
          {atomCount !== null && (
            <span>
              <span className="font-semibold text-[#374151] tabular-nums">{atomCount}</span> atoms
            </span>
          )}
          {chainCount !== null && (
            <>
              {atomCount !== null && <span className="text-[#cbd5e1]">·</span>}
              <span>
                <span className="font-semibold text-[#374151] tabular-nums">{chainCount}</span> chains
              </span>
            </>
          )}
          {externalCount !== null && externalCount > 0 && (
            <>
              <span className="text-[#cbd5e1]">·</span>
              <span>
                <span className="font-semibold text-[#374151] tabular-nums">{externalCount}</span> sources
              </span>
            </>
          )}
          {groundedCount > 0 && (
            <>
              <span className="text-[#cbd5e1]">·</span>
              <span className="inline-flex items-center gap-0.5 text-[#059669] font-semibold">
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
                  <path d="M2.5 6l2.5 2.5 4.5-4.5" />
                </svg>
                {groundedCount}/5 signals
              </span>
            </>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center justify-between pt-2 border-t border-black/[0.06]">
        <span className="text-[10.5px] font-medium text-[#8592a8]">
          {updatedLabel ? `Updated ${updatedLabel}` : "—"}
        </span>
        {!approved ? (
          <button
            onClick={handleApprove}
            className="inline-flex items-center gap-1 rounded-[6px] bg-[#0051ff] hover:bg-[#003bc4] text-white text-[11px] font-semibold px-2.5 py-1 transition-colors"
          >
            Approve
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M5 3l4 4-4 4" />
            </svg>
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0051ff]">
            View details
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-2.5 h-2.5">
              <path d="M5 3l4 4-4 4" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}
