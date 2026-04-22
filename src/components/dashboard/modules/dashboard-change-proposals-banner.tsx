"use client";

// ── DashboardChangeProposalsBanner (Arc 5.5 Phase B) ───────────────────
//
// Sticky-style banner on the main dashboard surfacing pending
// change_proposals that otherwise live only on the /strategy sub-page.
//
// Before this module, after the engine re-synthesised a confirmed
// strategy the user had to navigate to /strategy to discover there were
// pending adjustments. Now the dashboard surfaces them directly with a
// one-click jump to the full review panel.
//
// Design: reuses the Arc 3 banner's visual language (amber accent,
// kind distribution chips) but sized for dashboard placement.

import { useMemo } from "react";
import Link from "next/link";
import { Sparkles, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { StrategyChangeProposal } from "@/types/strategy";

interface Props {
  spaceId: string;
  proposals: StrategyChangeProposal[] | null | undefined;
  className?: string;
}

const KIND_LABELS: Record<StrategyChangeProposal["change_type"], string> = {
  modify_perspective: "modify",
  add_tactic: "add",
  remove_tactic: "remove",
  adjust_timeline: "timeline",
  reprioritize: "reorder",
  pivot: "pivot",
};

export function DashboardChangeProposalsBanner({
  spaceId,
  proposals,
  className,
}: Props) {
  const reducedMotion = useReducedMotion();

  const stats = useMemo(() => {
    const list = proposals ?? [];
    if (list.length === 0) return null;
    const dist: Record<string, number> = {};
    let urg: "low" | "medium" | "high" = "low";
    for (const p of list) {
      const key = KIND_LABELS[p.change_type];
      dist[key] = (dist[key] ?? 0) + 1;
      if (p.urgency === "high") urg = "high";
      else if (p.urgency === "medium" && urg !== "high") urg = "medium";
    }
    return { total: list.length, distribution: dist, maxUrgency: urg };
  }, [proposals]);

  if (!stats) return null;

  const urgencyDotClass =
    stats.maxUrgency === "high"
      ? "bg-red-500"
      : stats.maxUrgency === "medium"
        ? "bg-amber-500"
        : "bg-gray-400";

  const urgencyLabel =
    stats.maxUrgency === "high"
      ? "High urgency"
      : stats.maxUrgency === "medium"
        ? "Medium urgency"
        : "Low urgency";

  return (
    <Link
      href={`/app/space/${spaceId}/strategy#change-proposals`}
      className={cn(
        "group flex items-center gap-3 rounded-2xl px-4 py-3",
        "bg-gradient-to-r from-amber-50/70 via-white/75 to-amber-50/50 backdrop-blur-xl",
        "ring-1 ring-amber-200/70 hover:ring-amber-300",
        "shadow-[0_1px_3px_rgba(15,23,42,0.04)]",
        !reducedMotion && "transition-all duration-150 hover:shadow-[0_2px_10px_rgba(245,158,11,0.10)]",
        className,
      )}
      aria-live="polite"
      aria-label={`${stats.total} strategy proposed change${stats.total === 1 ? "" : "s"} pending — open review panel`}
    >
      <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">
        <Sparkles className="h-3.5 w-3.5" />
        {!reducedMotion && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-xl ring-2 ring-amber-300/60 animate-ping opacity-40"
            style={{ animationDuration: "2.4s" }}
          />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
            Strategy updates
          </span>
          <span className="text-[13px] font-semibold text-slate-900">
            {stats.total} proposed change{stats.total === 1 ? "" : "s"} ready to review
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-600">
            <span className={cn("h-1.5 w-1.5 rounded-full", urgencyDotClass)} />
            <span className="font-medium">{urgencyLabel}</span>
          </span>
          <span className="text-slate-300">·</span>
          {Object.entries(stats.distribution).map(([label, count], i, arr) => (
            <span key={label} className="contents">
              <span className="text-[10.5px] text-slate-600 tabular-nums">
                <span className="font-semibold">{count}</span>{" "}
                <span className="text-slate-500">{label}</span>
              </span>
              {i < arr.length - 1 && <span className="text-slate-300">·</span>}
            </span>
          ))}
        </div>
      </div>

      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold flex-shrink-0",
          "bg-white/80 text-amber-800 ring-1 ring-amber-200",
          "group-hover:bg-amber-500 group-hover:text-white group-hover:ring-amber-500",
          !reducedMotion && "transition-colors duration-150",
        )}
      >
        Review
        <ChevronRight className="h-3 w-3" />
      </span>
    </Link>
  );
}
