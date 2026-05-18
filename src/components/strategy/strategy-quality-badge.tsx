"use client";

// ── StrategyQualityBadge ──
//
// Surfaces the post-generation effectiveness check verdict produced by
// the LLM-as-judge pass (src/lib/pipeline/check-strategy-effectiveness).
// Renders a compact quality summary inline with the strategy hero so
// the user sees the independent judgment, not only the strategy's own
// self-reported provenance.
//
// Reads from `synthesis_data.strategy_effectiveness_check`. Hides
// entirely when the check is absent (older strategies, soft-failed
// judge calls). No regression for legacy spaces.
//
// Visual hierarchy:
//   1. Overall verdict pill (strong / acceptable / shallow / broken)
//      — color-coded, top-left, the headline read
//   2. Four narrow-question icons — bottleneck / axioms / convergences
//      / goal — with check/cross/score per dimension
//   3. Red-flags expandable line — collapsed by default; expands
//      inline when there are concerns
//
// Apple-grade restraint: no gradients on the card itself, neutral
// gray surface, one accent color reserved for the active state.

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Target,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import type { StrategyEffectivenessCheck } from "@/types/synthesis";

interface Props {
  check: StrategyEffectivenessCheck | null | undefined;
  /** Render as a compact single-line strip rather than a full card.
   *  Used by the canvas strategy hero where vertical space is scarce. */
  compact?: boolean;
}

/** Per-verdict visual treatment — color + label + glyph */
const VERDICT_META: Record<
  StrategyEffectivenessCheck["overall_quality"],
  { label: string; bg: string; text: string; ring: string; dotBg: string }
> = {
  strong: {
    label: "Strong",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    ring: "ring-emerald-200",
    dotBg: "bg-emerald-500",
  },
  acceptable: {
    label: "Acceptable",
    bg: "bg-blue-50",
    text: "text-blue-800",
    ring: "ring-blue-200",
    dotBg: "bg-blue-500",
  },
  shallow: {
    label: "Shallow",
    bg: "bg-amber-50",
    text: "text-amber-900",
    ring: "ring-amber-200",
    dotBg: "bg-amber-500",
  },
  broken: {
    label: "Needs work",
    bg: "bg-rose-50",
    text: "text-rose-800",
    ring: "ring-rose-200",
    dotBg: "bg-rose-500",
  },
};

export function StrategyQualityBadge({ check, compact = false }: Props) {
  const [expandedFlags, setExpandedFlags] = useState(false);

  // Soft-hide when no check exists. Strategies generated before this
  // shipped (or runs where the judge call soft-failed) just don't
  // render the badge — no missing-data placeholder, no error.
  if (!check) return null;

  const meta = VERDICT_META[check.overall_quality];
  const redFlagCount = check.red_flags?.length ?? 0;

  // ── Compact variant — single-line pill for canvas chrome ──
  if (compact) {
    return (
      <div
        className={[
          "inline-flex items-center gap-2 rounded-full px-2.5 py-1 ring-1",
          meta.bg,
          meta.text,
          meta.ring,
        ].join(" ")}
        title={check.reasoning}
      >
        <span
          aria-hidden
          className={`inline-flex h-1.5 w-1.5 rounded-full ${meta.dotBg}`}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
          {meta.label}
        </span>
        <span className="text-[11px] text-gray-500">
          · goal {check.goal_alignment_score}
        </span>
        {redFlagCount > 0 && (
          <span className="text-[11px] text-amber-700">
            · {redFlagCount} {redFlagCount === 1 ? "flag" : "flags"}
          </span>
        )}
      </div>
    );
  }

  // ── Full variant — card under the strategy hero ──
  return (
    <div
      className={[
        "rounded-xl bg-white p-3 ring-1",
        meta.ring,
      ].join(" ")}
    >
      {/* Top row: overall verdict + goal alignment */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={`inline-flex h-2 w-2 rounded-full ${meta.dotBg}`}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            Independent quality check
          </span>
          <span
            className={[
              "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1",
              meta.bg,
              meta.text,
              meta.ring,
            ].join(" ")}
          >
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Target className="h-3 w-3 text-gray-400" />
          <span className="text-[11px] font-medium text-gray-700">
            {check.goal_alignment_score}
            <span className="text-gray-400">/100 goal align</span>
          </span>
        </div>
      </div>

      {/* Four-question pills row */}
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <DimensionPill
          icon={Zap}
          label="Bottleneck"
          passing={check.bottleneck_addressed}
          tooltip={check.bottleneck_reasoning}
        />
        <DimensionPill
          icon={Check}
          label="Axioms"
          passing={check.critical_axioms_grounded}
          tooltip={check.axioms_reasoning}
        />
        <DimensionPill
          icon={TrendingUp}
          label="Convergences"
          passing={check.convergences_used}
          tooltip={check.convergences_reasoning}
        />
        <DimensionPill
          icon={Target}
          label="Goal"
          passing={check.goal_alignment_score >= 60}
          tooltip={check.goal_reasoning}
          scoreLabel={`${check.goal_alignment_score}`}
        />
      </div>

      {/* Holistic reasoning — 2-3 sentences */}
      <p className="mt-3 text-[12px] leading-relaxed text-gray-700">
        {check.reasoning}
      </p>

      {/* Red flags — collapsed by default, expandable inline */}
      {redFlagCount > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2.5">
          <button
            onClick={() => setExpandedFlags((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-800 transition hover:text-amber-900"
            aria-expanded={expandedFlags}
          >
            {expandedFlags ? (
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3 w-3" strokeWidth={2} />
            )}
            <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
            {redFlagCount} {redFlagCount === 1 ? "red flag" : "red flags"} the judge surfaced
          </button>

          {expandedFlags && (
            <ul className="mt-2 space-y-1.5 pl-5">
              {check.red_flags.map((flag, i) => (
                <li
                  key={i}
                  className="text-[11px] leading-relaxed text-gray-700"
                >
                  <span className="mr-1.5 text-amber-700">•</span>
                  {flag}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tiny meta line — checked_at */}
      {check.checked_at && (
        <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-400">
          Checked {relativeTime(check.checked_at)}
        </div>
      )}
    </div>
  );
}

// ── DimensionPill — one of the four narrow questions ──

function DimensionPill({
  icon: Icon,
  label,
  passing,
  tooltip,
  scoreLabel,
}: {
  icon: typeof Check;
  label: string;
  passing: boolean;
  tooltip?: string;
  scoreLabel?: string;
}) {
  return (
    <div
      className={[
        "flex items-center gap-1.5 rounded-md px-2 py-1.5 ring-1",
        passing
          ? "bg-emerald-50/60 ring-emerald-100"
          : "bg-rose-50/60 ring-rose-100",
      ].join(" ")}
      title={tooltip}
    >
      <span
        className={[
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          passing ? "bg-emerald-500 text-white" : "bg-rose-500 text-white",
        ].join(" ")}
      >
        {passing ? (
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        ) : (
          <X className="h-2.5 w-2.5" strokeWidth={3} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[10px] font-medium text-gray-700">
          <Icon className="h-2.5 w-2.5 shrink-0 text-gray-400" />
          <span className="truncate">{label}</span>
        </div>
        {scoreLabel && (
          <div className="font-mono text-[9px] text-gray-500">
            {scoreLabel}/100
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
