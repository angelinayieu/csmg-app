"use client";

// ── Strategy Carousel widget (VP Project — "the chosen path & alternatives")
//
// Renders a horizontal coverflow of `RankedStrategy[]` — the top-ranked
// recommendation plus each alternative, each one a card with headline,
// posture pill, confidence, ranking_rationale, and tradeoff_vs_top.
//
// The design goal is "here's why #1 won without hiding what you gave up";
// the top card is centered and slightly larger, alternatives fan out to
// the right at reduced scale. No scroll — widget is meant to sit in a
// single row of the report template.
//
// Data source: `ranked_strategies` resolver reads
// synthesis_data.strategic_recommendation.ranked_strategies[]. Zero extra
// fetches.

import { useState } from "react";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type { RankedStrategy } from "@/types/strategy";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";
import { cn } from "@/lib/utils";

interface StrategyCarouselConfig {
  title?: string;
  /** Cap on rendered cards. Default 5 (rank 1..5). */
  maxCards?: number;
}

// Posture → accent colour. Kept muted — the rank badge is the primary
// emphasis, posture is secondary context.
const POSTURE_ACCENT: Record<string, string> = {
  aggressive_growth: "#ef4444",
  cautious_validation: "#0ea5e9",
  pivot_exploration: "#a855f7",
  consolidation: "#10b981",
  defensive: "#64748b",
};

const POSTURE_LABEL: Record<string, string> = {
  aggressive_growth: "Aggressive growth",
  cautious_validation: "Cautious validation",
  pivot_exploration: "Pivot exploration",
  consolidation: "Consolidation",
  defensive: "Defensive",
};

export function StrategyCarousel({
  instance,
  context,
}: WidgetComponentProps<StrategyCarouselConfig>) {
  const cfg = instance.config ?? {};
  const stratsRes = context.resolve<RankedStrategy[]>(instance.bindings?.strategies);
  const allStrats = stratsRes.value ?? [];

  // Maintain the active index locally so the user can explore alternatives
  // without the widget losing state on re-renders.
  const [activeIdx, setActiveIdx] = useState(0);

  if (allStrats.length === 0) {
    return (
      <Surface density="comfortable">
        <WidgetTitle
          eyebrow="Strategies"
          title={cfg.title ?? "Ranked alternatives"}
        />
        <WidgetEmpty>
          No ranked strategies generated yet. These land at the end of the
          strategy-refresh run — one top recommendation plus alternatives.
        </WidgetEmpty>
      </Surface>
    );
  }

  const maxCards = cfg.maxCards ?? 5;
  const strategies = [...allStrats]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maxCards);

  const active = strategies[Math.min(activeIdx, strategies.length - 1)];

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Strategies"
        title={cfg.title ?? "Ranked alternatives"}
        subtitle={`${strategies.length} paths — #1 recommended, ${strategies.length - 1} tradeoff-bearing alternatives`}
      />
      {/* Tab-strip selector — simpler than a true coverflow for a dashboard
          card and works well on narrow columns. */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
        {strategies.map((s, i) => (
          <StrategyTab
            key={s.rank}
            strategy={s}
            active={i === activeIdx}
            onClick={() => setActiveIdx(i)}
          />
        ))}
      </div>
      {active && <StrategyPanel strategy={active} />}
    </Surface>
  );
}

// ── Tab ─────────────────────────────────────────────────────────────

function StrategyTab({
  strategy,
  active,
  onClick,
}: {
  strategy: RankedStrategy;
  active: boolean;
  onClick: () => void;
}) {
  const accent =
    POSTURE_ACCENT[strategy.recommendation.strategic_posture] ?? "#64748b";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all",
        active
          ? "border-gray-900 bg-gray-900 text-white shadow-sm"
          : "border-gray-200 bg-white/70 text-gray-600 hover:border-gray-300 hover:text-gray-900",
      )}
    >
      <span
        className={cn(
          "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold",
          active ? "bg-white/20 text-white" : "text-white",
        )}
        style={active ? undefined : { background: accent }}
      >
        {strategy.rank}
      </span>
      <span className="max-w-[140px] truncate">
        {strategy.recommendation.headline ??
          strategy.recommendation.title ??
          `Strategy #${strategy.rank}`}
      </span>
    </button>
  );
}

// ── Active panel ────────────────────────────────────────────────────

function StrategyPanel({ strategy }: { strategy: RankedStrategy }) {
  const rec = strategy.recommendation;
  const accent = POSTURE_ACCENT[rec.strategic_posture] ?? "#64748b";
  const postureLabel =
    POSTURE_LABEL[rec.strategic_posture] ?? rec.strategic_posture;
  const conf = Math.round(rec.confidence);
  const isTop = strategy.rank === 1;
  const hasAgentSpecs = strategy.infrastructure_proposals.some(
    (p) => (p.agent_specs?.length ?? 0) > 0,
  );

  return (
    <div
      className="mt-3 rounded-xl border p-4"
      style={{
        borderColor: `${accent}55`,
        background: `linear-gradient(135deg, ${accent}08 0%, ${accent}02 60%, transparent 100%)`,
      }}
    >
      {/* Headline + posture */}
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
              style={{ background: accent }}
            >
              {isTop ? "Top pick" : `Rank #${strategy.rank}`}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {postureLabel}
            </span>
            <span className="text-[10px] text-gray-400">·</span>
            <span className="text-[10px] font-semibold text-gray-700">
              {conf}% conf.
            </span>
          </div>
          <div className="text-[14px] font-semibold leading-snug text-gray-900">
            {rec.headline ?? rec.title}
          </div>
          {rec.headline && rec.title !== rec.headline && (
            <div className="mt-0.5 text-[11.5px] text-gray-500">
              {rec.title}
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
        {rec.summary}
      </p>

      {/* Ranking rationale — why this rank */}
      <div className="mt-3 border-t border-gray-200/70 pt-2.5">
        <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">
          Why this rank
        </div>
        <p className="text-[11.5px] leading-relaxed text-gray-700">
          {strategy.ranking_rationale}
        </p>
      </div>

      {/* Tradeoff vs top — only for non-top strategies */}
      {strategy.tradeoff_vs_top && (
        <div className="mt-2.5 rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2">
          <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-amber-700">
            Tradeoff vs #1
          </div>
          <p className="text-[11.5px] leading-relaxed text-amber-900">
            {strategy.tradeoff_vs_top}
          </p>
        </div>
      )}

      {/* Footer: proposal count + agent hint */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10.5px] text-gray-500">
        <span>
          <span className="font-bold text-gray-900">
            {strategy.infrastructure_proposals.length}
          </span>{" "}
          infrastructure proposal
          {strategy.infrastructure_proposals.length === 1 ? "" : "s"}
        </span>
        {hasAgentSpecs && (
          <>
            <span className="text-gray-300">·</span>
            <span>Staffed by named agents</span>
          </>
        )}
      </div>
    </div>
  );
}
