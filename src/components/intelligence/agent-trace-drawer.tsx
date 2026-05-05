"use client";

import { X, ArrowRight, ExternalLink, Search, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFullscreenDrawer } from "@/components/canvas/drawers/use-fullscreen-drawer";
import { DrawerFullscreenButton } from "@/components/canvas/drawers/drawer-fullscreen-button";
import type { ResearchAgent } from "@/types/intelligence";
import type { SuggestedObjective, ImprovementGoal } from "@/types/goals";
import type { Entity } from "@/types";
import type { SynthesisData, ContinuationSignalData } from "@/types/synthesis";

interface AgentTraceDrawerProps {
  agent: ResearchAgent;
  synthesisData: SynthesisData | null;
  entities: Entity[];
  suggestedObjectives: SuggestedObjective[];
  goals: ImprovementGoal[];
  onClose: () => void;
  /** drawer: fixed-right 480px; page: fills parent */
  mode?: "drawer" | "page";
}

export function AgentTraceDrawer({
  agent,
  synthesisData,
  entities,
  suggestedObjectives,
  goals,
  onClose,
  mode = "drawer",
}: AgentTraceDrawerProps) {
  // Resolve source
  const sourceObjective = agent.source_objective_id
    ? suggestedObjectives.find((o) => o.key === agent.source_objective_id)
    : null;
  const sourceGoal = agent.source_goal_id
    ? goals.find((g) => g.id === agent.source_goal_id)
    : null;

  // Causal chain entities
  const causalChain = sourceObjective?.causal_chain ?? [];
  const entityById = new Map<string, Entity>();
  for (const e of entities) {
    entityById.set(e.id, e);
    entityById.set(e.entity_id, e);
  }

  // Continuation signals produced from this agent
  const continuationSignals: ContinuationSignalData[] = (synthesisData?.continuation_signals ?? []).filter(
    (cs) => cs.follow_up_queries?.some((q) => agent.focus_areas.some((fa) => q.toLowerCase().includes(fa.toLowerCase()))),
  );

  // Research triggers (filter by matching focus areas)
  const researchTriggers =
    (synthesisData?.research_triggers as { triggers?: Array<{ question: string; priority?: string; focus_areas?: string[] }> } | undefined)?.triggers ?? [];
  const matchingTriggers = researchTriggers.filter((t) =>
    (t.focus_areas ?? []).some((fa) =>
      agent.focus_areas.some((af) => af.toLowerCase() === fa.toLowerCase()),
    ),
  );

  // Discovered entities
  const discoveredEntities = agent.entity_ids
    .map((id) => entityById.get(id))
    .filter((e): e is Entity => !!e)
    .slice(0, 20);

  const { isFullscreen, toggleFullscreen } = useFullscreenDrawer(mode === "drawer");

  return (
    <div
      className={cn(
        "flex flex-col bg-white overflow-hidden transition-[width] duration-200 ease-out",
        mode === "drawer"
          ? cn(
              "fixed right-0 top-0 bottom-0 z-40 border-l border-gray-200 shadow-xl",
              isFullscreen ? "w-screen" : "w-[480px]",
            )
          : "h-full",
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-500">
            <span className="font-bold uppercase tracking-wider text-[#007AFF]">
              Agent trace
            </span>
            <span className="text-gray-300">&middot;</span>
            <span className="font-mono font-semibold text-gray-700">
              {agent.callsign ?? agent.name}
            </span>
          </div>
          <h3 className="text-base font-bold text-gray-900">{agent.name}</h3>
          {agent.specialty && (
            <p className="mt-0.5 text-[13px] text-gray-500">{agent.specialty}</p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {mode === "drawer" && (
            <DrawerFullscreenButton
              isFullscreen={isFullscreen}
              onToggle={toggleFullscreen}
            />
          )}
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:text-gray-700"
            title="Close drawer"
            aria-label="Close drawer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Source section */}
        {(sourceObjective || sourceGoal) && (
          <TraceSection label="Source" icon="◆">
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#007AFF]">
                {sourceObjective ? "Sub-objective" : "Improvement goal"}
              </div>
              <p className="text-[13px] font-semibold text-gray-900">
                {sourceObjective?.title ?? sourceGoal?.title}
              </p>
              {sourceObjective?.rationale && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
                  {sourceObjective.rationale}
                </p>
              )}
              {sourceGoal?.description && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
                  {sourceGoal.description}
                </p>
              )}
              {sourceObjective?.propellant && (
                <div className="mt-2 rounded-md bg-white border border-blue-100 px-2.5 py-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                    Propellant
                  </div>
                  <p className="mt-0.5 text-[11px] font-medium text-gray-800">
                    {sourceObjective.propellant.action}
                  </p>
                </div>
              )}
            </div>
          </TraceSection>
        )}

        {/* Causal chain */}
        {causalChain.length > 0 && (
          <TraceSection label={`Causal chain · ${causalChain.length} hops`} icon="→">
            <div className="space-y-1">
              {causalChain.map((eid, i) => {
                const ent = entityById.get(eid);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-[9px] font-bold text-[#007AFF]">
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-[12px] text-gray-800">
                      {ent?.name ?? eid}
                    </span>
                    {ent?.entity_category && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-500">
                        {ent.entity_category}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </TraceSection>
        )}

        {/* Research triggers fired */}
        {matchingTriggers.length > 0 && (
          <TraceSection label={`Research triggers · ${matchingTriggers.length}`} icon={<Search className="h-3 w-3" />}>
            <div className="space-y-1.5">
              {matchingTriggers.slice(0, 5).map((t, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                >
                  <p className="text-[12px] font-medium text-gray-800">{t.question}</p>
                  {t.priority && (
                    <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                      {t.priority}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </TraceSection>
        )}

        {/* Continuation signals */}
        {continuationSignals.length > 0 && (
          <TraceSection label={`Continuation signals · ${continuationSignals.length}`} icon={<Zap className="h-3 w-3" />}>
            <div className="space-y-1.5">
              {continuationSignals.slice(0, 5).map((cs, i) => (
                <div key={i} className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                      {cs.type.replace(/_/g, " ")}
                    </span>
                    {cs.priority && (
                      <span className="text-[10px] text-amber-600">{cs.priority}</span>
                    )}
                  </div>
                  <p className="text-[12px] text-gray-700">{cs.description}</p>
                </div>
              ))}
            </div>
          </TraceSection>
        )}

        {/* Discovered entities */}
        {discoveredEntities.length > 0 && (
          <TraceSection
            label={`Discovered entities · ${agent.entity_ids.length}`}
            icon={<ExternalLink className="h-3 w-3" />}
          >
            <div className="flex flex-wrap gap-1.5">
              {discoveredEntities.map((ent) => (
                <span
                  key={ent.id}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-800"
                >
                  {ent.name}
                  {ent.confidence != null && (
                    <span className="text-[10px] text-gray-400">
                      {Math.round(ent.confidence * 100)}%
                    </span>
                  )}
                </span>
              ))}
              {agent.entity_ids.length > discoveredEntities.length && (
                <span className="text-[10px] text-gray-400">
                  +{agent.entity_ids.length - discoveredEntities.length} more
                </span>
              )}
            </div>
          </TraceSection>
        )}

        {/* Search queries used (fallback to focus areas) */}
        <TraceSection label="Search domain" icon={<ArrowRight className="h-3 w-3" />}>
          <div className="flex flex-wrap gap-1.5">
            {agent.focus_areas.map((fa) => (
              <span
                key={fa}
                className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-medium text-[#007AFF]"
              >
                #{fa}
              </span>
            ))}
          </div>
        </TraceSection>

        {/* Empty state if nothing to show */}
        {!sourceObjective && !sourceGoal && causalChain.length === 0 &&
         matchingTriggers.length === 0 && continuationSignals.length === 0 &&
         discoveredEntities.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-xs text-gray-400">No trace data yet.</p>
            <p className="mt-1 text-[11px] text-gray-300">
              Run this agent to populate the reasoning trail.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TraceSection({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-gray-300">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
