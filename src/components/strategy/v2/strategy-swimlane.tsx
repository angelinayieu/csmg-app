"use client";

// ── Strategy swimlane ──────────────────────────────────────────────────
//
// Timeline view of a strategy: 4 horizon lanes (Now / Short / Medium /
// Long) on the horizontal axis, rows for Micro-tactics + one row per BSC
// perspective. Each cell is an action card with effort/impact badges.
//
// Why a hand-rolled swimlane instead of a Gantt library: Gantt libs
// assume project-management semantics (dependencies, drag-resize, time
// scales) we don't have. The data is coarsely bucketed — the four
// horizons are categorical, not continuous time. CSS Grid handles this
// better than any Gantt lib at a fraction of the bundle.

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Clock, Target, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  StrategicRecommendation,
  MicroTactic,
} from "@/types/strategy";
import { VizContainer } from "@/components/viz/viz-container";
import { DataStateLayer } from "@/components/viz/data-state";

type Horizon = "now" | "short_term" | "medium_term" | "long_term";

const HORIZONS: Array<{ key: Horizon; label: string; sub: string }> = [
  { key: "now",          label: "Now",       sub: "This week" },
  { key: "short_term",   label: "Short",     sub: "This month" },
  { key: "medium_term",  label: "Medium",    sub: "Next quarter" },
  { key: "long_term",    label: "Long",      sub: "Beyond" },
];

interface LaneRow {
  key: string;
  label: string;
  sub?: string;
  /** Keyed by horizon so we can bin with zero hunting. */
  byHorizon: Record<Horizon, SwimlaneCard[]>;
}

interface SwimlaneCard {
  id: string;
  title: string;
  subtitle?: string;
  effort?: "low" | "medium" | "high";
  impact?: "low" | "medium" | "high";
  entityName?: string;
}

const EFFORT_COLOR: Record<"low" | "medium" | "high", string> = {
  low: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-red-50 text-red-700",
};

const IMPACT_COLOR: Record<"low" | "medium" | "high", string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-indigo-50 text-indigo-700",
  high: "bg-indigo-600 text-white",
};

function emptyByHorizon(): Record<Horizon, SwimlaneCard[]> {
  return { now: [], short_term: [], medium_term: [], long_term: [] };
}

function tacticToCard(t: MicroTactic): SwimlaneCard {
  return {
    id: t.id ?? `tactic-${t.title}`,
    title: t.title,
    subtitle: t.macro_link,
    effort: t.effort,
    impact: t.impact,
    entityName: t.entity_name,
  };
}

interface Props {
  recommendation: StrategicRecommendation;
}

export function StrategySwimlane({ recommendation }: Props) {
  const rows = useMemo<LaneRow[]>(() => {
    const out: LaneRow[] = [];

    // Row 0: Micro tactics (strategy-wide, no perspective)
    if (recommendation.micro_tactics && recommendation.micro_tactics.length > 0) {
      const tacticRow: LaneRow = {
        key: "tactics",
        label: "Tactics",
        sub: `${recommendation.micro_tactics.length}`,
        byHorizon: emptyByHorizon(),
      };
      for (const t of recommendation.micro_tactics) {
        tacticRow.byHorizon[t.timeframe].push(tacticToCard(t));
      }
      out.push(tacticRow);
    }

    // Row N: One per perspective
    for (const p of recommendation.perspectives ?? []) {
      const row: LaneRow = {
        key: p.id ?? p.name,
        label: p.name,
        sub: p.objective,
        byHorizon: emptyByHorizon(),
      };
      for (const a of p.actions ?? []) {
        row.byHorizon[a.timeframe].push({
          id: `${row.key}::${a.text}`,
          title: a.text,
          subtitle: a.infrastructure_note,
        });
      }
      out.push(row);
    }

    return out;
  }, [recommendation]);

  const totalCards = rows.reduce(
    (acc, r) =>
      acc +
      HORIZONS.reduce((a, h) => a + r.byHorizon[h.key].length, 0),
    0,
  );

  return (
    <VizContainer
      icon={Clock}
      title="Execution timeline"
      subtitle={
        totalCards === 0
          ? "No tactics or actions yet — the strategy shows up here once generated."
          : `${totalCards} item${totalCards === 1 ? "" : "s"} across ${rows.length} lane${rows.length === 1 ? "" : "s"} and 4 horizons.`
      }
      minBodyHeight={320}
    >
      <DataStateLayer
        empty={rows.length === 0 || totalCards === 0}
        emptyHint="The swimlane populates once the strategy has tactics + perspective actions."
      >
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            {/* Header row — horizon labels */}
            <div
              className="grid text-[10px] uppercase tracking-wide text-gray-500 border-b border-black/5 pb-2 mb-1"
              style={{ gridTemplateColumns: "180px repeat(4, 1fr)" }}
            >
              <div />
              {HORIZONS.map((h) => (
                <div key={h.key} className="px-2">
                  <div className="font-bold text-gray-700">{h.label}</div>
                  <div className="text-gray-400 normal-case tracking-normal">
                    {h.sub}
                  </div>
                </div>
              ))}
            </div>

            {/* Rows */}
            <div className="divide-y divide-black/5">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className="grid items-stretch py-2"
                  style={{ gridTemplateColumns: "180px repeat(4, 1fr)" }}
                >
                  {/* Row header */}
                  <div className="pr-3 pt-1 border-r border-black/5">
                    <p className="text-[11.5px] font-semibold text-gray-900 leading-tight">
                      {row.label}
                    </p>
                    {row.sub ? (
                      <p className="text-[10px] text-gray-500 line-clamp-2 mt-0.5">
                        {row.sub}
                      </p>
                    ) : null}
                  </div>

                  {/* Horizon cells */}
                  {HORIZONS.map((h) => (
                    <div
                      key={h.key}
                      className={cn(
                        "px-1.5 flex flex-col gap-1 min-h-[52px]",
                        h.key === "now" && "bg-indigo-50/20",
                      )}
                    >
                      {row.byHorizon[h.key].map((card, ci) => (
                        <SwimlaneCardView key={card.id} card={card} index={ci} />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DataStateLayer>
    </VizContainer>
  );
}

function SwimlaneCardView({ card, index = 0 }: { card: SwimlaneCard; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: Math.min(index, 16) * 0.02,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -1 }}
      className="rounded-lg bg-white/85 backdrop-blur-sm ring-1 ring-black/5 px-2 py-1.5 cursor-pointer transition-shadow duration-200 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_6px_16px_-6px_rgba(8,60,180,0.12),0_1px_2px_rgba(0,0,0,0.04)] hover:ring-black/10"
    >
      <p className="text-[11px] font-semibold text-gray-900 leading-tight line-clamp-2">
        {card.title}
      </p>
      {card.entityName ? (
        <p className="text-[9.5px] text-gray-500 mt-0.5 flex items-center gap-1 truncate">
          <Target className="h-2.5 w-2.5 shrink-0" />
          {card.entityName}
        </p>
      ) : card.subtitle ? (
        <p className="text-[9.5px] text-gray-500 mt-0.5 line-clamp-2">{card.subtitle}</p>
      ) : null}
      {(card.effort || card.impact) && (
        <div className="flex items-center gap-1 mt-1">
          {card.effort && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1 py-[1px] text-[8.5px] font-semibold",
                EFFORT_COLOR[card.effort],
              )}
            >
              <Zap className="h-2 w-2" />
              {card.effort}
            </span>
          )}
          {card.impact && (
            <span
              className={cn(
                "rounded-full px-1 py-[1px] text-[8.5px] font-semibold",
                IMPACT_COLOR[card.impact],
              )}
            >
              {card.impact} impact
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}
