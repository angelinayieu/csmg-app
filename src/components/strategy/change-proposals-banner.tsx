"use client";

// ── Change Proposals Banner ─────────────────────────────────────────────
//
// Slim top-of-page announcement that surfaces when synthesis has produced
// deltas vs the previously confirmed strategy. Acts as the visual handle
// for the (larger) <ChangeProposalsPanel /> — when collapsed, shows the
// distribution of proposed changes; when expanded, renders the full panel
// inline below it.
//
// Design notes:
//   • Glass surface w/ amber accent — matches the "needs review" grammar
//     used elsewhere (staleness banner, consent filter). Consistent with
//     the Apple Vision Pro palette: ring-1 + backdrop-blur.
//   • Kind distribution chips: "2 modify · 1 add · 1 pivot" so the user
//     sees the shape of changes without clicking.
//   • Urgency dot: red if any `high`, amber if any `medium`, else neutral.
//   • Hidden entirely when proposals are empty (parent can always render
//     it safely).
//   • Announces "N updates available" via aria-live="polite".
//   • Respects prefers-reduced-motion (no chevron bounce).

import React, { useMemo } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StrategyChangeProposal } from "@/types/strategy";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

const KIND_LABELS: Record<StrategyChangeProposal["change_type"], string> = {
  modify_perspective: "modify",
  add_tactic: "add",
  remove_tactic: "remove",
  adjust_timeline: "timeline",
  reprioritize: "reorder",
  pivot: "pivot",
};

interface Props {
  proposals: StrategyChangeProposal[];
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}

export function ChangeProposalsBanner({
  proposals,
  expanded,
  onToggle,
  className,
}: Props) {
  const reducedMotion = useReducedMotion();

  const { distribution, maxUrgency } = useMemo(() => {
    const dist: Record<string, number> = {};
    let urg: "low" | "medium" | "high" = "low";
    for (const p of proposals) {
      const key = KIND_LABELS[p.change_type];
      dist[key] = (dist[key] ?? 0) + 1;
      if (p.urgency === "high") urg = "high";
      else if (p.urgency === "medium" && urg !== "high") urg = "medium";
    }
    return { distribution: dist, maxUrgency: urg };
  }, [proposals]);

  if (proposals.length === 0) return null;

  const urgencyDotClass =
    maxUrgency === "high"
      ? "bg-red-500"
      : maxUrgency === "medium"
        ? "bg-amber-500"
        : "bg-gray-400";

  const urgencyLabel =
    maxUrgency === "high"
      ? "High urgency"
      : maxUrgency === "medium"
        ? "Medium urgency"
        : "Low urgency";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls="change-proposals-panel"
      className={cn(
        "group w-full rounded-2xl px-4 py-3 text-left",
        "bg-gradient-to-r from-amber-50/70 via-white/70 to-amber-50/50",
        "ring-1 ring-amber-200/70 hover:ring-amber-300",
        "backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.03)]",
        "transition-all",
        !reducedMotion && "hover:shadow-[0_2px_10px_rgba(245,158,11,0.10)]",
        className,
      )}
    >
      <div
        className="flex items-center gap-3 flex-wrap"
        aria-live="polite"
      >
        {/* Pulse icon */}
        <span
          className={cn(
            "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 ring-1 ring-amber-200",
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {!reducedMotion && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-xl ring-2 ring-amber-300/60 animate-ping opacity-40"
              style={{ animationDuration: "2.4s" }}
            />
          )}
        </span>

        {/* Title + distribution */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
              Strategy updates
            </span>
            <span className="text-[13px] font-semibold text-gray-900">
              {proposals.length} proposed change{proposals.length === 1 ? "" : "s"} ready to review
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10.5px] text-gray-600">
              <span className={cn("h-1.5 w-1.5 rounded-full", urgencyDotClass)} />
              <span className="font-medium">{urgencyLabel}</span>
            </span>
            <span className="text-gray-300">·</span>
            {Object.entries(distribution).map(([label, count], i, arr) => (
              <React.Fragment key={label}>
                <span className="text-[10.5px] text-gray-600 tabular-nums">
                  <span className="font-semibold">{count}</span>{" "}
                  <span className="text-gray-500">{label}</span>
                </span>
                {i < arr.length - 1 && <span className="text-gray-300">·</span>}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* CTA */}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold",
            "bg-white/80 text-amber-800 ring-1 ring-amber-200",
            "group-hover:bg-amber-500 group-hover:text-white group-hover:ring-amber-500",
            "transition-colors",
          )}
        >
          {expanded ? "Hide" : "Review"}
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              !reducedMotion && "duration-200",
              expanded && "rotate-180",
            )}
          />
        </span>
      </div>
    </button>
  );
}
