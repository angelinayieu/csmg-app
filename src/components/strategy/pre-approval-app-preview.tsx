"use client";

// ── Pre-approval app preview (Arc 2, Item 2) ──
//
// Before the user commits via Approve & launch, show them EXACTLY what will be
// materialized. The strategy's infrastructure_proposals is a complete spec of
// every app + its agent roster + mechanisms — it's already in the data; we
// just never surfaced it pre-approval before.
//
// Design principles:
//   • Compact card grid — each app one tile, all visible at once (no tabs)
//   • Typography hero: app name at 14px bold, type/complexity chips below
//   • Progressive disclosure: base card shows name + description + chips;
//     agent_specs + mechanism_hints expand via inline accordion on click
//   • Apple-Vision-Pro palette: glass surface, ring-1 chip colors, soft
//     shadow with low saturation
//   • Sort by priority (1 = highest first); top 3 get slightly larger visual
//   • Empty state: "No infrastructure proposals on this variant — the
//     strategy has tactics but hasn't committed to tool/app specs yet."

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Box, Wrench, LayoutGrid, Workflow, Cable, Eye,
  ChevronDown, Users, Sparkles,
} from "lucide-react";
import type { InfrastructureProposal, AgentSpec, MechanismHint } from "@/types/strategy";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface Props {
  proposals: InfrastructureProposal[];
  className?: string;
}

const TYPE_META: Record<InfrastructureProposal["type"], { label: string; icon: React.ElementType; tint: string }> = {
  app: { label: "App", icon: Box, tint: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  tool: { label: "Tool", icon: Wrench, tint: "bg-purple-50 text-purple-700 ring-purple-200" },
  dashboard: { label: "Dashboard", icon: LayoutGrid, tint: "bg-blue-50 text-blue-700 ring-blue-200" },
  workflow: { label: "Workflow", icon: Workflow, tint: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  integration: { label: "Integration", icon: Cable, tint: "bg-amber-50 text-amber-700 ring-amber-200" },
  monitor: { label: "Monitor", icon: Eye, tint: "bg-rose-50 text-rose-700 ring-rose-200" },
};

const COMPLEXITY_META: Record<InfrastructureProposal["complexity"], { label: string; cls: string }> = {
  low: { label: "low complexity", cls: "text-emerald-700 bg-emerald-50 ring-emerald-100" },
  medium: { label: "medium complexity", cls: "text-amber-700 bg-amber-50 ring-amber-100" },
  high: { label: "high complexity", cls: "text-rose-700 bg-rose-50 ring-rose-100" },
};

const MECHANISM_LABEL: Partial<Record<MechanismHint, string>> = {
  simulation: "Simulation lab",
  prediction: "Prediction ledger",
  validation: "Validation checks",
  baseline_tracking: "Baseline tracker",
  deviation_capture: "Deviation capture",
  game: "Game mechanics",
  ml_personalization: "ML personalization",
};

export function PreApprovalAppPreview({ proposals, className }: Props) {
  if (!proposals || proposals.length === 0) {
    return (
      <section
        className={cn(
          "rounded-2xl border border-gray-200/60 bg-white/50 backdrop-blur-xl px-5 py-4 text-[11px] text-gray-500 italic",
          className,
        )}
      >
        No infrastructure proposals on this variant yet — the strategy has tactics but hasn&apos;t committed to tool/app specs.
      </section>
    );
  }

  const sorted = [...proposals].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  const byType = new Map<string, number>();
  for (const p of sorted) byType.set(p.type, (byType.get(p.type) ?? 0) + 1);
  const totalAgents = sorted.reduce((n, p) => n + (p.agent_specs?.length ?? 0), 0);

  return (
    <section
      className={cn(
        "rounded-2xl border border-indigo-200/50 bg-gradient-to-br from-indigo-50/30 to-white/80 backdrop-blur-xl shadow-[0_1px_3px_rgba(99,102,241,0.06)]",
        className,
      )}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 border-b border-indigo-100/50">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
            <Sparkles className="h-3 w-3" />
          </span>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-700">
              What will be created
            </div>
            <div className="text-[11px] text-gray-600 leading-tight">
              Review before approving — these apps materialize the moment you confirm
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 tabular-nums">
          <span className="rounded-full bg-white ring-1 ring-indigo-100 px-1.5 py-[1px] font-semibold text-indigo-700">
            {sorted.length} {sorted.length === 1 ? "app" : "apps"}
          </span>
          {totalAgents > 0 && (
            <span className="rounded-full bg-white ring-1 ring-gray-200 px-1.5 py-[1px]">
              {totalAgents} {totalAgents === 1 ? "agent" : "agents"}
            </span>
          )}
        </div>
      </div>

      {/* Type distribution strip */}
      {byType.size > 1 && (
        <div className="px-5 py-2 border-b border-indigo-100/30 flex items-center gap-1.5 flex-wrap text-[10px]">
          <span className="text-gray-400 uppercase tracking-wider font-semibold">Mix:</span>
          {Array.from(byType.entries()).map(([type, count]) => {
            const meta = TYPE_META[type as InfrastructureProposal["type"]];
            if (!meta) return null;
            const Icon = meta.icon;
            return (
              <span
                key={type}
                className={cn("inline-flex items-center gap-1 rounded-full ring-1 px-1.5 py-[1px] font-semibold", meta.tint)}
              >
                <Icon className="h-2.5 w-2.5" />
                {count} {meta.label.toLowerCase()}{count > 1 ? "s" : ""}
              </span>
            );
          })}
        </div>
      )}

      {/* Grid of app preview cards */}
      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        {sorted.map((p, idx) => (
          <AppPreviewCard key={p.id} proposal={p} featured={idx < 2 && sorted.length >= 3} />
        ))}
      </div>
    </section>
  );
}

function AppPreviewCard({ proposal, featured }: { proposal: InfrastructureProposal; featured: boolean }) {
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[proposal.type] ?? TYPE_META.app;
  const Icon = meta.icon;
  const complexityMeta = COMPLEXITY_META[proposal.complexity] ?? COMPLEXITY_META.medium;
  const hasExpandableContent = (proposal.agent_specs?.length ?? 0) > 0
    || (proposal.mechanism_hints?.length ?? 0) > 0
    || (proposal.metrics_tracked?.length ?? 0) > 0;

  return (
    <div
      className={cn(
        "group rounded-xl bg-white/90 backdrop-blur-md ring-1 ring-gray-200/70 overflow-hidden",
        !reducedMotion && "transition-all duration-200 hover:shadow-[0_2px_10px_rgba(99,102,241,0.1)]",
        "hover:ring-indigo-300/70",
        featured && "md:col-span-2",
      )}
    >
      <button
        type="button"
        onClick={() => hasExpandableContent && setExpanded((v) => !v)}
        className={cn(
          "w-full text-left px-3.5 py-3 flex items-start gap-3",
          hasExpandableContent && "cursor-pointer",
        )}
      >
        {/* Icon + priority ring */}
        <div className="relative shrink-0">
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg ring-1", meta.tint)}>
            <Icon className="h-4 w-4" />
          </span>
          {proposal.priority <= 2 && (
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-600 text-white text-[8px] font-bold tabular-nums ring-2 ring-white">
              {proposal.priority}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-[13px] font-bold text-gray-900 leading-snug truncate">
              {proposal.name}
            </h4>
            {hasExpandableContent && (
              <ChevronDown
                className={cn(
                  "h-3 w-3 shrink-0 text-gray-400",
                  !reducedMotion && "transition-transform duration-200",
                  expanded && "rotate-180",
                )}
              />
            )}
          </div>
          <p className={cn(
            "text-[11px] text-gray-600 leading-snug mt-0.5",
            !expanded && "line-clamp-2",
          )}>
            {proposal.description}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-semibold", meta.tint)}>
              {meta.label}
            </span>
            <span className={cn("rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-medium", complexityMeta.cls)}>
              {complexityMeta.label}
            </span>
            {proposal.source_perspective && (
              <span className="rounded-full bg-gray-50 ring-1 ring-gray-200 px-1.5 py-[1px] text-[9px] text-gray-600">
                {proposal.source_perspective}
              </span>
            )}
            {(proposal.agent_specs?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 ring-1 ring-violet-100 px-1.5 py-[1px] text-[9px] font-medium text-violet-700">
                <Users className="h-2.5 w-2.5" />
                {proposal.agent_specs?.length} agent{(proposal.agent_specs?.length ?? 0) > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded detail: agents + mechanisms + metrics */}
      {expanded && hasExpandableContent && (
        <div className="px-3.5 pb-3 pt-2 border-t border-gray-100 space-y-2.5">
          {proposal.agent_specs && proposal.agent_specs.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1">
                Agent roster
              </div>
              <div className="space-y-1">
                {proposal.agent_specs.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )}

          {proposal.mechanism_hints && proposal.mechanism_hints.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1">
                Twin mechanisms
              </div>
              <div className="flex flex-wrap gap-1">
                {proposal.mechanism_hints.map((h) => (
                  <span
                    key={h}
                    className="rounded-full bg-cyan-50 ring-1 ring-cyan-100 text-cyan-700 text-[9.5px] font-medium px-1.5 py-[1px]"
                  >
                    {MECHANISM_LABEL[h] ?? h}
                  </span>
                ))}
              </div>
            </div>
          )}

          {proposal.metrics_tracked && proposal.metrics_tracked.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500 mb-1">
                Metrics tracked
              </div>
              <div className="flex flex-wrap gap-1">
                {proposal.metrics_tracked.slice(0, 10).map((m, i) => (
                  <span
                    key={`${m}-${i}`}
                    className="rounded bg-gray-50 ring-1 ring-gray-200 text-gray-700 text-[9.5px] font-medium px-1.5 py-[1px]"
                  >
                    {m}
                  </span>
                ))}
                {proposal.metrics_tracked.length > 10 && (
                  <span className="text-[9px] text-gray-400 italic self-center">
                    +{proposal.metrics_tracked.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentSpec }) {
  const roleTint: Record<AgentSpec["role"], string> = {
    reasoner: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    measurer: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    predictor: "bg-violet-50 text-violet-700 ring-violet-100",
    validator: "bg-amber-50 text-amber-700 ring-amber-100",
    simulator: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    recommender: "bg-blue-50 text-blue-700 ring-blue-100",
    critic: "bg-rose-50 text-rose-700 ring-rose-100",
  };
  return (
    <div className="flex items-start gap-1.5 text-[10px]">
      <span className={cn("rounded ring-1 px-1 py-[1px] text-[9px] font-semibold shrink-0 uppercase tracking-wide", roleTint[agent.role])}>
        {agent.role}
      </span>
      <span className="text-gray-700 leading-snug">{agent.responsibility}</span>
    </div>
  );
}
