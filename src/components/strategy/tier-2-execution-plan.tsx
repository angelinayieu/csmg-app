"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Target,
  Zap,
  ArrowRight,
  Clock,
  GitBranch,
  RefreshCw,
  Workflow,
  FlaskConical,
} from "lucide-react";
import { ExecutionFlowchart } from "@/components/strategy/execution-flowchart";
import { useExecutionBrief } from "@/lib/hooks/use-execution-brief";
import { ExecutionBriefPanel } from "@/components/strategy/execution-brief-panel";
import type {
  StrategicRecommendation,
  MicroTactic,
  InfrastructureProposal,
} from "@/types/strategy";
import type { Entity } from "@/types";

// ── Props ──

export interface Tier2ExecutionPlanProps {
  recommendation: StrategicRecommendation;
  entityMap: Map<string, Entity>;
  infraProposals?: InfrastructureProposal[];
  spaceId?: string;
  onTacticClick?: (tactic: MicroTactic) => void;
}

// ── Config ──

const timeframeLabels: Record<string, string> = {
  now: "Now",
  short_term: "1-2 weeks",
  medium_term: "1-3 months",
  long_term: "3+ months",
};

const effortColors: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

const impactColors: Record<string, string> = {
  high: "bg-green-100 text-green-700",
  medium: "bg-blue-100 text-blue-700",
  low: "bg-gray-100 text-gray-500",
};

// ── Entity reference badge ──

function EntityRef({ id, entityMap }: { id: string; entityMap: Map<string, Entity> }) {
  const entity = entityMap.get(id);
  const isExternal = id.startsWith("X");
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
      isExternal ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"
    )}>
      {id}{entity ? `: ${entity.name}` : ""}
    </span>
  );
}

// ── Micro Tactic Row ──

function MicroTacticRow({ tactic, entityMap, onClick }: { tactic: MicroTactic; entityMap: Map<string, Entity>; onClick?: () => void }) {
  return (
    <button
      className="w-full flex items-start gap-2.5 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2 text-left hover:border-interaxis-200 hover:bg-interaxis-50/20 transition-all group"
      onClick={onClick}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-interaxis-500 text-[10px] font-bold text-white flex-shrink-0 mt-0.5">
        {tactic.priority}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-800 group-hover:text-interaxis-700">{tactic.title}</p>
        <p className="mt-0.5 text-[10px] text-gray-500 line-clamp-2">{tactic.description}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <EntityRef id={tactic.entity_id} entityMap={entityMap} />
          <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", effortColors[tactic.effort])}>
            {tactic.effort} effort
          </span>
          <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", impactColors[tactic.impact])}>
            {tactic.impact} impact
          </span>
          <span className="text-[10px] text-gray-400">{timeframeLabels[tactic.timeframe] ?? tactic.timeframe}</span>
        </div>
        {/* Metric target */}
        <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
          <Target className="h-2.5 w-2.5" />
          <span>{tactic.metric.name}: {tactic.metric.target}{tactic.metric.unit ? ` ${tactic.metric.unit}` : ""}</span>
        </div>
        {/* Implementation intention */}
        {tactic.implementation_intention && (
          <div className="mt-1.5 rounded border border-blue-100 bg-blue-50/30 px-2 py-1">
            <span className="text-[10px] font-semibold text-blue-500">When/If - Then</span>
            <p className="text-[10px] text-blue-800 mt-0.5">
              <span className="text-blue-500">When </span>
              {tactic.implementation_intention.trigger}
              <span className="text-blue-500"> - then </span>
              {tactic.implementation_intention.action}
            </p>
          </div>
        )}
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-interaxis-400 flex-shrink-0 mt-1 transition-colors" />
    </button>
  );
}

// ── Wrapper: Micro tactic + execution brief ──

function MicroTacticWithBrief({
  tactic,
  entityMap,
  spaceId,
  onClick,
}: {
  tactic: MicroTactic;
  entityMap: Map<string, Entity>;
  spaceId: string;
  onClick?: () => void;
}) {
  const [briefOpen, setBriefOpen] = useState(false);

  const { brief, loading, error, generate } = useExecutionBrief({
    spaceId,
    recommendationId: `tactic-${tactic.id}`,
    recommendationType: "micro_tactic",
    recommendationTitle: tactic.title,
    recommendationText: [tactic.title, tactic.description].join(" — "),
    relatedEntityIds: [tactic.entity_id],
  });

  const handleToggleBrief = (e: React.MouseEvent) => {
    e.stopPropagation();
    const opening = !briefOpen;
    setBriefOpen(opening);
    if (opening && !brief && !loading) generate();
  };

  return (
    <div>
      <MicroTacticRow tactic={tactic} entityMap={entityMap} onClick={onClick} />
      <div className="ml-7 mt-1">
        <button
          onClick={handleToggleBrief}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
            briefOpen
              ? "bg-indigo-100 text-indigo-700"
              : "bg-gray-50 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600"
          )}
        >
          <FlaskConical className="h-3 w-3" />
          Execution brief
          <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", briefOpen && "rotate-180")} />
        </button>
        {briefOpen && (
          <div className="mt-2">
            <ExecutionBriefPanel
              brief={brief}
              loading={loading}
              error={error}
              onGenerate={generate}
              testLabParams={{
                spaceId,
                recommendationId: `tactic-${tactic.id}`,
                recommendationTitle: tactic.title,
                recommendationText: [tactic.title, tactic.description].join(" — "),
                relatedEntityIds: [tactic.entity_id],
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──

export function Tier2ExecutionPlan({
  recommendation: rec,
  entityMap,
  infraProposals = [],
  spaceId,
  onTacticClick,
}: Tier2ExecutionPlanProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAllTactics, setShowAllTactics] = useState(false);
  const [showInfraProposals, setShowInfraProposals] = useState(true);

  const visibleTactics = showAllTactics ? rec.micro_tactics : rec.micro_tactics.slice(0, 3);

  return (
    <div className="border-t border-gray-200 pt-3">
      {/* Collapsible header */}
      <button
        className="w-full flex items-center justify-between text-left group"
        onClick={() => setExpanded(!expanded)}
      >
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-interaxis-600 group-hover:text-interaxis-700">
          <Workflow className="h-3.5 w-3.5" />
          Execution Plan
          <span className="rounded-full bg-interaxis-100 px-1.5 py-0.5 text-[11px] font-medium text-interaxis-500">
            {rec.temporal_phases.length} phases &middot; {rec.micro_tactics.length} tactics
          </span>
        </h4>
        <ChevronDown className={cn("h-3.5 w-3.5 text-interaxis-300 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {/* ── Temporal Phases (horizontal timeline) ── */}
          {rec.temporal_phases.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                <Clock className="h-3 w-3" />
                Temporal Flow
              </h4>
              <div className="flex gap-1">
                {rec.temporal_phases.map((phase, i) => (
                  <div key={i} className="flex-1 min-w-0 rounded-lg border border-gray-100 bg-gray-50/50 px-2.5 py-2 relative">
                    {i < rec.temporal_phases.length - 1 && (
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
                        <ArrowRight className="h-3.5 w-3.5 text-gray-300" />
                      </div>
                    )}
                    <div className="text-[10px] font-bold text-interaxis-600">{phase.label}</div>
                    <p className="mt-0.5 text-[10px] text-gray-700 font-medium leading-tight">{phase.focus}</p>
                    <div className="mt-1 border-t border-gray-100 pt-1">
                      <div className="text-[10px] text-gray-400">Measure</div>
                      <div className="text-[11px] text-gray-600">{phase.key_metric}</div>
                    </div>
                    <div className="mt-0.5">
                      <div className="text-[10px] text-gray-400">Milestone</div>
                      <div className="text-[11px] text-green-600 font-medium">{phase.milestone}</div>
                    </div>
                    {phase.loops_activated?.length ? (
                      <div className="mt-0.5 text-[10px] text-blue-500 flex items-center gap-0.5">
                        <RefreshCw className="h-2 w-2" /> {phase.loops_activated.length} loops
                      </div>
                    ) : null}
                    {phase.infrastructure_deployed?.length ? (
                      <div className="mt-0.5 flex flex-wrap gap-0.5">
                        {phase.infrastructure_deployed.map((eid) => (
                          <EntityRef key={eid} id={eid} entityMap={entityMap} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Micro Tactics (top 3 + view all) ── */}
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <Zap className="h-3 w-3" />
              Micro Tactics
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-400">
                {rec.micro_tactics.length} steps
              </span>
            </h4>
            <div className="space-y-1.5">
              {visibleTactics.map((tactic) =>
                spaceId ? (
                  <MicroTacticWithBrief
                    key={tactic.id}
                    tactic={tactic}
                    entityMap={entityMap}
                    spaceId={spaceId}
                    onClick={() => onTacticClick?.(tactic)}
                  />
                ) : (
                  <MicroTacticRow
                    key={tactic.id}
                    tactic={tactic}
                    entityMap={entityMap}
                    onClick={() => onTacticClick?.(tactic)}
                  />
                )
              )}
            </div>
            {rec.micro_tactics.length > 3 && (
              <button
                onClick={() => setShowAllTactics(!showAllTactics)}
                className="mt-2 flex w-full items-center justify-center gap-1 text-xs font-medium text-interaxis-600 hover:text-interaxis-700 transition-colors"
              >
                {showAllTactics ? "Show less" : `View all ${rec.micro_tactics.length} tactics`}
                <ChevronDown className={cn("h-3 w-3 transition-transform", showAllTactics && "rotate-180")} />
              </button>
            )}
          </div>

          {/* ── Execution Flowchart ── */}
          {rec.micro_tactics.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-interaxis-600">
                <Workflow className="h-3 w-3" />
                Execution Flowchart
                <span className="rounded-full bg-interaxis-100 px-1.5 py-0.5 text-[11px] font-medium text-interaxis-500">
                  {rec.micro_tactics.length} steps
                </span>
                {rec.micro_tactics.some((t) => t.dependencies?.length > 0) && (
                  <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-500">
                    dependency-aware
                  </span>
                )}
              </h4>
              <ExecutionFlowchart
                recommendation={rec}
                entityMap={entityMap}
                onTacticClick={onTacticClick}
              />
            </div>
          )}

          {/* ── Infrastructure Map ── */}
          {rec.infrastructure_map && rec.infrastructure_map.core_components?.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                <GitBranch className="h-3 w-3" />
                Infrastructure Map
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-400">
                  {rec.infrastructure_map.core_components.length} components
                </span>
              </h4>

              {/* Components */}
              <div className="space-y-1">
                {rec.infrastructure_map.core_components.map((comp, i) => {
                  const statusColors: Record<string, string> = {
                    exists: "bg-green-100 text-green-700",
                    needs_strengthening: "bg-amber-100 text-amber-700",
                    needs_building: "bg-red-100 text-red-700",
                  };
                  const roleIcons: Record<string, string> = {
                    hub: "H", input: "I", output: "O", processor: "P", monitor: "M", gate: "G",
                  };
                  return (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/30 px-2.5 py-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-indigo-100 text-[11px] font-bold text-indigo-600 flex-shrink-0 mt-0.5">
                        {roleIcons[comp.role] ?? "?"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <EntityRef id={comp.entity_id} entityMap={entityMap} />
                          <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", statusColors[comp.status] ?? "bg-gray-100 text-gray-500")}>
                            {comp.status.replace(/_/g, " ")}
                          </span>
                          {comp.priority === "critical" && (
                            <span className="text-[10px] text-red-500 font-bold">CRITICAL</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] text-gray-600">{comp.description}</p>
                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-gray-400">
                          {comp.receives_from.length > 0 && (
                            <span>receives: {comp.receives_from.join(", ")}</span>
                          )}
                          {comp.produces_for.length > 0 && (
                            <span>produces: {comp.produces_for.join(", ")}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Key Channels */}
              {rec.infrastructure_map.key_channels?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {rec.infrastructure_map.key_channels.map((ch, i) => (
                    <span key={i} className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                      ch.exists ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"
                    )}>
                      {ch.from} &rarr; {ch.to}
                      <span className="text-[7px] opacity-60">{ch.channel_type}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Activated Loops */}
              {rec.infrastructure_map.activated_loops?.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {rec.infrastructure_map.activated_loops.map((loop, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <RefreshCw className="h-2.5 w-2.5 text-blue-400" />
                      <span className="text-gray-600">{loop.name}</span>
                      <span className="text-[10px] text-gray-400">activates in {loop.activation_phase}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Infrastructure Proposals ── */}
          {infraProposals.length > 0 && (
            <div className="border-t border-gray-200 pt-3">
              <button
                className="w-full flex items-center justify-between text-left group"
                onClick={() => setShowInfraProposals(!showInfraProposals)}
              >
                <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-600 group-hover:text-indigo-700">
                  <GitBranch className="h-3 w-3" />
                  Supporting Infrastructure Setup Proposals
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[11px] font-medium text-indigo-500">
                    {infraProposals.length}
                  </span>
                </h4>
                <ChevronDown className={cn("h-3.5 w-3.5 text-indigo-300 transition-transform", showInfraProposals && "rotate-180")} />
              </button>

              {showInfraProposals && (
                <div className="mt-2 space-y-2">
                  {infraProposals.map((proposal, i) => {
                    const typeIcons: Record<string, string> = {
                      app: "A", tool: "T", dashboard: "D", workflow: "W", integration: "I", monitor: "M",
                    };
                    const complexityColors: Record<string, string> = {
                      low: "bg-green-100 text-green-700",
                      medium: "bg-amber-100 text-amber-700",
                      high: "bg-red-100 text-red-700",
                    };
                    return (
                      <div key={proposal.id} className="rounded-lg border border-indigo-100 bg-gradient-to-r from-indigo-50/30 to-white p-3 hover:border-indigo-200 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-xs font-bold text-indigo-600">
                              #{i + 1}
                            </span>
                            <span className="flex h-5 w-5 items-center justify-center rounded bg-indigo-500 text-[10px] font-bold text-white">
                              {typeIcons[proposal.type] ?? "?"}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-900">{proposal.name}</span>
                              <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", complexityColors[proposal.complexity] ?? "bg-gray-100 text-gray-500")}>
                                {proposal.complexity}
                              </span>
                              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{proposal.type}</span>
                            </div>
                            <p className="mt-0.5 text-[10px] text-gray-600 leading-relaxed">{proposal.description}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] text-gray-400">Supports:</span>
                              <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">{proposal.source_perspective}</span>
                              {proposal.source_components?.map((cid) => (
                                <EntityRef key={cid} id={cid} entityMap={entityMap} />
                              ))}
                            </div>
                            {proposal.metrics_tracked?.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                <span className="text-[10px] text-gray-400">Tracks:</span>
                                {proposal.metrics_tracked.map((m, mi) => (
                                  <span key={mi} className="rounded bg-green-50 px-1 py-0.5 text-[10px] text-green-600">{m}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full border-2 border-green-300 text-green-500 hover:bg-green-50 cursor-pointer transition-colors">
                            <ArrowRight className="h-4 w-4" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
