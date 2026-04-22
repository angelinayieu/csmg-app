"use client";

// ── StepApps (Arc 5C.2 / P0.2) ─────────────────────────────────────────
//
// Step 2 of the intake review. Shows the N infrastructure_proposals that
// will be materialized as apps when the user confirms. Per-card:
//   • Name + description + type chip
//   • Agent responsibilities (synthesized from agent_specs[])
//   • Metrics tracked (as small pills)
//   • Mechanism hints
//   • Toggle off (defer — won't be materialized as app/mechanism/interventions)
//
// The user needs this step because the existing pre-approval-app-preview
// is read-only. Here they can actually defer apps they don't want yet.

import { useMemo } from "react";
import {
  Box,
  Wrench,
  LayoutGrid,
  Workflow,
  Cable,
  Eye,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { AgentSpec, InfrastructureProposal } from "@/types/strategy";
import type { IntakeReviewState } from "./types";

const TYPE_META: Record<
  InfrastructureProposal["type"],
  { icon: typeof Box; tint: string; label: string }
> = {
  app: { icon: LayoutGrid, tint: "text-indigo-600 bg-indigo-50 ring-indigo-200", label: "App" },
  tool: { icon: Wrench, tint: "text-amber-600 bg-amber-50 ring-amber-200", label: "Tool" },
  dashboard: { icon: LayoutGrid, tint: "text-cyan-600 bg-cyan-50 ring-cyan-200", label: "Dashboard" },
  workflow: { icon: Workflow, tint: "text-emerald-600 bg-emerald-50 ring-emerald-200", label: "Workflow" },
  integration: { icon: Cable, tint: "text-violet-600 bg-violet-50 ring-violet-200", label: "Integration" },
  monitor: { icon: Eye, tint: "text-rose-600 bg-rose-50 ring-rose-200", label: "Monitor" },
};

const COMPLEXITY_CHIP: Record<InfrastructureProposal["complexity"], string> = {
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  high: "bg-rose-50 text-rose-700 ring-rose-200",
};

interface Props {
  /**
   * Infrastructure proposals come from the active ranked strategy rather
   * than directly off StrategicRecommendation. The parent extracts them
   * from `ranked_strategies[matching].infrastructure_proposals[]`.
   */
  proposals: InfrastructureProposal[];
  state: IntakeReviewState;
  onChange: (next: IntakeReviewState) => void;
}

export function StepApps({ proposals: rawProposals, state, onChange }: Props) {
  const reducedMotion = useReducedMotion();
  const proposals = useMemo<InfrastructureProposal[]>(() => {
    return [...rawProposals].sort((a, b) => a.priority - b.priority);
  }, [rawProposals]);

  const toggleDefer = (id: string) => {
    const next = new Set(state.deferredProposalIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...state, deferredProposalIds: next });
  };

  const activeCount = proposals.length - state.deferredProposalIds.size;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-2 text-[11.5px] text-slate-500">
        <LayoutGrid className="h-3.5 w-3.5 text-indigo-600" />
        <span>
          <span className="font-semibold tabular-nums text-slate-900">{activeCount}</span>{" "}
          of <span className="tabular-nums">{proposals.length}</span> apps will be built.
          Tap any card to defer.
        </span>
      </div>

      {/* Proposal cards */}
      {proposals.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <LayoutGrid className="h-7 w-7 text-slate-300" aria-hidden />
          <p className="text-[12.5px] text-slate-500">
            No infrastructure proposals — the strategy has tactics but hasn't committed to
            tool specs yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {proposals.map((p) => {
            const meta = TYPE_META[p.type] ?? TYPE_META.app;
            const Icon = meta.icon;
            const deferred = state.deferredProposalIds.has(p.id);
            return (
              <li
                key={p.id}
                className={cn(
                  "rounded-2xl bg-white ring-1 px-4 py-3 overflow-hidden",
                  !reducedMotion && "transition-[opacity,background] duration-150",
                  deferred
                    ? "opacity-50 bg-slate-50 ring-slate-200"
                    : "ring-slate-200/70 hover:shadow-[0_1px_4px_rgba(15,23,42,0.05)]",
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Type icon + priority ring */}
                  <div className="relative flex-shrink-0">
                    <span
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl ring-1",
                        meta.tint,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {p.priority <= 2 && (
                      <span
                        className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-600 text-white text-[8px] font-bold tabular-nums ring-2 ring-white"
                        title={`Priority ${p.priority}`}
                      >
                        {p.priority}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="truncate text-[13.5px] font-bold text-slate-900">
                        {p.name}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-semibold",
                          COMPLEXITY_CHIP[p.complexity] ?? "",
                        )}
                      >
                        {p.complexity}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-slate-600 line-clamp-3">
                      {p.description}
                    </p>

                    {/* Agent responsibilities (synthesized) */}
                    {p.agent_specs && p.agent_specs.length > 0 && (
                      <div className="mt-2 flex items-start gap-1.5">
                        <Users className="h-3 w-3 mt-0.5 flex-shrink-0 text-slate-400" />
                        <div className="text-[10.5px] leading-relaxed text-slate-600">
                          <span className="font-semibold text-slate-500">
                            {p.agent_specs.length} agent{p.agent_specs.length === 1 ? "" : "s"}:
                          </span>{" "}
                          {p.agent_specs.map((a: AgentSpec, i: number) => (
                            <span key={a.id ?? i}>
                              {i > 0 ? " · " : ""}
                              <span className="font-semibold">{a.role}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Metrics tracked */}
                    {p.metrics_tracked && p.metrics_tracked.length > 0 && (
                      <div className="mt-2 flex items-start gap-1.5">
                        <Zap className="h-3 w-3 mt-0.5 flex-shrink-0 text-slate-400" />
                        <div className="flex flex-wrap gap-1">
                          {p.metrics_tracked.slice(0, 5).map((m: string) => (
                            <span
                              key={m}
                              className="inline-flex items-center rounded-full bg-slate-50 px-1.5 py-[1px] text-[9.5px] font-medium text-slate-600 ring-1 ring-slate-200"
                            >
                              {m}
                            </span>
                          ))}
                          {p.metrics_tracked.length > 5 && (
                            <span className="text-[9.5px] text-slate-400 tabular-nums">
                              +{p.metrics_tracked.length - 5}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Mechanism hints */}
                    {p.mechanism_hints && p.mechanism_hints.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.mechanism_hints.map((h: string) => (
                          <span
                            key={h}
                            className="inline-flex items-center rounded-full bg-indigo-50 px-1.5 py-[1px] text-[9.5px] font-medium text-indigo-700 ring-1 ring-indigo-200"
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Defer toggle */}
                  <button
                    type="button"
                    onClick={() => toggleDefer(p.id)}
                    aria-pressed={!deferred}
                    aria-label={deferred ? `Re-enable ${p.name}` : `Defer ${p.name}`}
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-semibold flex-shrink-0",
                      !reducedMotion && "transition-colors duration-150",
                      deferred
                        ? "bg-slate-200 text-slate-600 hover:bg-slate-300"
                        : "bg-emerald-500 text-white hover:bg-emerald-600",
                    )}
                  >
                    {deferred ? "Deferred" : "Active"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
