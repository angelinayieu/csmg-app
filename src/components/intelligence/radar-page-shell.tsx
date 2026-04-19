"use client";

import { useMemo, useState } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Space, Entity, Edge } from "@/types";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";
import type { SynthesisData } from "@/types/synthesis";
import type { ResearchAgent, IntelligenceSignal } from "@/types/intelligence";
import { useIntelligenceRadar } from "@/lib/hooks/use-intelligence-radar";
import { useAgentRuntime } from "@/lib/hooks/use-agent-runtime";
import { deriveWorkstreams } from "@/lib/intelligence/derive-workstreams";

import { MissionHeroCard } from "./mission-hero-card";
import { AutonomousDecisionCard } from "./autonomous-decision-card";
import { WorkstreamsBar } from "./workstreams-bar";
import { AllocationRadarChart, type RadarAxis } from "./allocation-radar-chart";
import { SignalStreamCard } from "./signal-stream-card";
import { AgentFleetStrip } from "./agent-fleet-strip";
import { ScheduleTimelineStrip } from "./schedule-timeline-strip";
import { AgentTraceDrawer } from "./agent-trace-drawer";

interface RadarPageShellProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  goals: ImprovementGoal[];
  activeGoal: ImprovementGoal | null;
  className?: string;
}

export function RadarPageShell({
  space,
  entities,
  edges,
  goals,
  activeGoal,
  className,
}: RadarPageShellProps) {
  const radar = useIntelligenceRadar(space, entities, edges, goals);
  const runtime = useAgentRuntime(space.id);
  // Prefer live agent runtime when populated; fall back to derived fleet
  const fleetSource: ResearchAgent[] = useMemo(
    () => (runtime.fleet.length > 0 ? runtime.fleet : radar.agentFleet),
    [runtime.fleet, radar.agentFleet]
  );
  const [activeWorkstreamId, setActiveWorkstreamId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<ResearchAgent | null>(null);

  // Parse synthesis data for sub-objectives and trace
  const synthData: SynthesisData | null = useMemo(() => {
    const synthRaw = space.synthesis_data;
    if (!synthRaw) return null;
    try {
      return (typeof synthRaw === "string" ? JSON.parse(synthRaw) : synthRaw) as SynthesisData;
    } catch {
      return null;
    }
  }, [space.synthesis_data]);

  const suggestedObjectives: SuggestedObjective[] = useMemo(
    () => synthData?.suggested_objectives ?? [],
    [synthData],
  );

  // Derive workstreams
  const workstreams = useMemo(
    () =>
      deriveWorkstreams({
        suggestedObjectives,
        improvementGoals: goals,
        signals: radar.signals,
        entities,
      }),
    [suggestedObjectives, goals, radar.signals, entities],
  );

  // Active workstream entity filter
  const activeEntitySet: Set<string> | null = useMemo(() => {
    if (!activeWorkstreamId) return null;
    const ws = workstreams.find((w) => w.id === activeWorkstreamId);
    if (!ws) return null;
    return new Set(ws.entityIds);
  }, [activeWorkstreamId, workstreams]);

  // Filtered signals per workstream
  const filteredSignals: IntelligenceSignal[] = useMemo(() => {
    if (!activeEntitySet) return radar.signals;
    return radar.signals.filter((s) => {
      if (activeEntitySet.has(s.entity_id)) return true;
      return (s.related_internal_entities ?? []).some((id) => activeEntitySet.has(id));
    });
  }, [activeEntitySet, radar.signals]);

  // Filtered agent fleet per workstream (uses live-preferred fleetSource)
  const filteredAgents: ResearchAgent[] = useMemo(() => {
    if (!activeEntitySet) return fleetSource;
    return fleetSource.filter((a) =>
      a.entity_ids.some((id) => activeEntitySet.has(id)) ||
      (a.source_objective_id && workstreams.find((w) =>
        w.id === activeWorkstreamId && w.source === "suggested_objective" &&
        "key" in w.sourceData && (w.sourceData as SuggestedObjective).key === a.source_objective_id,
      )),
    );
  }, [activeEntitySet, fleetSource, workstreams, activeWorkstreamId]);

  // Compute radar axes from workstreams (3+ workstreams) or fall back to knowledge stack
  const radarAxes: RadarAxis[] = useMemo(() => {
    if (workstreams.length >= 3) {
      const maxSignals = Math.max(1, ...workstreams.map((w) => w.signalCount));
      return workstreams.slice(0, 8).map((w) => ({
        key: w.id,
        label: w.label.length > 14 ? w.label.slice(0, 12) + "…" : w.label,
        current: Math.min(1, w.signalCount / maxSignals),
        target: Math.min(1, (w.signalCount / maxSignals) * 1.3 + 0.2),
        proposed: Math.min(1, (w.signalCount / maxSignals) * 1.4 + 0.15),
      }));
    }
    return []; // falls back to legacy 6-axis derivation in the chart
  }, [workstreams]);

  // Top priority decision (from v2)
  const topDecision = radar.radarV2?.priority_decisions_v2?.[0];

  // Active goal for mission metadata
  const missionScope = activeGoal
    ? `${activeGoal.title}${activeGoal.deadline ? ` by ${formatDeadline(activeGoal.deadline)}` : ""}`
    : undefined;

  // Harvest rate: signals detected in last 24h
  const harvestRate24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return radar.signals.filter((s) => new Date(s.detected_at).getTime() > cutoff).length;
  }, [radar.signals]);

  // Integrity: avg credibility × 100
  const integrityPct = (radar.stackHealth?.avg_credibility ?? 0) * 100;

  return (
    <div className={cn("flex h-full flex-col bg-white overflow-hidden", className)}>
      {/* Research status banners */}
      {radar.researchResult && (
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-green-100 bg-emerald-50 px-6 py-2">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <Zap className="h-3 w-3 text-emerald-600" />
          </div>
          <span className="flex-1 text-[11px] font-medium text-emerald-700">
            Research complete: <strong>{radar.researchResult.entitiesCreated}</strong> entities,{" "}
            <strong>{radar.researchResult.edgesCreated}</strong> edges
            {(radar.researchResult.searchesPerformed ?? 0) > 0 && (
              <>
                , <strong>{radar.researchResult.searchesPerformed}</strong> web searches
              </>
            )}
          </span>
          <button
            onClick={() => radar.dismissResearchResult()}
            className="rounded p-0.5 text-emerald-400 hover:bg-emerald-100 hover:text-emerald-600"
          >
            ×
          </button>
        </div>
      )}
      {radar.researchError && (
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-red-100 bg-red-50 px-6 py-2">
          <span className="text-[11px] font-medium text-red-700">
            Research failed: {radar.researchError}
          </span>
        </div>
      )}

      {/* Scrollable main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-4 space-y-4">
          {/* Workstreams bar */}
          {workstreams.length > 0 && (
            <WorkstreamsBar
              workstreams={workstreams}
              activeId={activeWorkstreamId}
              onSelect={setActiveWorkstreamId}
            />
          )}

          {/* Mission hero card */}
          <MissionHeroCard
            researchLoading={radar.researchLoading}
            harvestRate24h={harvestRate24h}
            integrityPct={integrityPct}
            nextRunAt={radar.schedule?.next_run_at ?? null}
            missionName={space.name}
            missionScope={missionScope}
            executiveSummary={radar.radarV2?.narrative?.executive_summary}
          />

          {/* Autonomous decision card (if present) */}
          {topDecision && (
            <AutonomousDecisionCard
              title={topDecision.decision_question ?? "Autonomous research decision pending"}
              detail={topDecision.recommended_reason ?? undefined}
              agentCallsign={agentCallsignForDecision(topDecision.id)}
              confidence={topDecision.confidence ?? 0.85}
              sourcesCount={topDecision.evidence_refs?.length}
              reversible
              trigger={topDecision.next_action?.slice(0, 60)}
              affects={(topDecision.affected_entities ?? []).slice(0, 3).map((eid) => {
                const ent = entities.find((e) => e.entity_id === eid);
                return {
                  label: ent?.name ?? eid,
                  tone: "blue" as const,
                };
              })}
              onAccept={() => {
                // Accept: escalate related signals if any
                for (const evRef of topDecision.evidence_refs ?? []) {
                  radar.updateSignalStatus(evRef, "escalated");
                }
              }}
              onOverride={() => {
                for (const evRef of topDecision.evidence_refs ?? []) {
                  radar.updateSignalStatus(evRef, "dismissed");
                }
              }}
              onExplain={() => {
                // Future: open explanation drawer
              }}
            />
          )}

          {/* Main 2-column grid: Allocation (left) + Signal stream (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4 min-h-[480px]">
            {/* Allocation map */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <AllocationRadarChart
                counts={radar.stackCounts}
                coverageBreakdown={radar.coverageBreakdown}
                axes={radarAxes.length > 0 ? radarAxes : undefined}
                showModeTabs
                title="Allocation map"
                subtitle="Where the fleet is currently focused"
              />
              <div className="mt-3 text-[10px] text-gray-400">
                {radarAxes.length > 0 ? (
                  <>Derived from {radarAxes.length} active workstreams</>
                ) : (
                  <>Knowledge stack coverage across 6 dimensions</>
                )}
              </div>
            </div>

            {/* Signal stream */}
            <SignalStreamCard
              signals={filteredSignals}
              entities={entities}
              onSignalAction={radar.updateSignalStatus}
              onSelectEntity={radar.setSelectedEntityId}
            />
          </div>
        </div>
      </div>

      {/* Fixed bottom: Agent fleet strip + schedule timeline */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50/80 px-6 py-3 space-y-2.5">
        <AgentFleetStrip
          agents={filteredAgents}
          onSelectAgent={setSelectedAgent}
          selectedAgentId={selectedAgent?.id ?? null}
          manageFleetHref={`/app/space/${space.id}/agents`}
        />
        {radar.schedule && (
          <ScheduleTimelineStrip
            schedule={radar.schedule}
            onUpdate={(u) => radar.updateSchedule(u)}
          />
        )}
      </div>

      {/* Agent trace drawer (right-side slide-out) */}
      {selectedAgent && (
        <AgentTraceDrawer
          agent={selectedAgent}
          synthesisData={synthData}
          entities={entities}
          suggestedObjectives={suggestedObjectives}
          goals={goals}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}

// ── Helpers ──

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatRelativeDetected(iso?: string): string | undefined {
  if (!iso) return undefined;
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function agentCallsignForDecision(id?: string): string | undefined {
  if (!id) return undefined;
  const pool = ["ATLAS", "ORION", "VEGA", "HELIOS", "LYRA", "NOVA", "CYGNUS", "RIGEL"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const base = pool[Math.abs(h) % pool.length];
  const suffix = String(Math.abs(h) % 100).padStart(2, "0");
  return `${base}-${suffix}`;
}
