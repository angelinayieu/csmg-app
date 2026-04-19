"use client";

import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Clock,
  Target,
  Zap,
  GitBranch,
  Workflow,
  Layers,
  RefreshCw,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Link2,
  ArrowUpRight,
  Box,
  Gauge,
  Wrench,
  Radio,
  X,
} from "lucide-react";
import type {
  StrategicRecommendation,
  MicroTactic,
  InfrastructureMap,
} from "@/types/strategy";
import type { Entity } from "@/types";

// ── Types ──

interface FlowNode {
  id: string;
  type: "tactic" | "infrastructure" | "milestone" | "phase_header";
  tactic?: MicroTactic;
  infraComponent?: InfrastructureMap["core_components"][number];
  phaseLabel?: string;
  phaseFocus?: string;
  col: number;
  row: number;
  dependencies: string[];
  unlocks: string[];
  channels: string[];
  phase: string;
}

interface FlowEdge {
  from: string;
  to: string;
  type: "dependency" | "channel" | "infrastructure" | "phase_transition";
  label?: string;
}

interface ExecutionFlowchartProps {
  recommendation: StrategicRecommendation;
  entityMap: Map<string, Entity>;
  onTacticClick?: (tactic: MicroTactic) => void;
  className?: string;
}

// ── Constants ──

const PHASE_ORDER = ["now", "short_term", "medium_term", "long_term"];
const PHASE_LABELS: Record<string, string> = {
  now: "Immediate",
  short_term: "Short Term (1-2 weeks)",
  medium_term: "Medium Term (1-3 months)",
  long_term: "Long Term (3+ months)",
};

const PHASE_COLORS: Record<string, { bg: string; border: string; text: string; accent: string; node: string }> = {
  now: { bg: "bg-red-50/40", border: "border-red-200", text: "text-red-700", accent: "#EF4444", node: "border-red-300" },
  short_term: { bg: "bg-amber-50/40", border: "border-amber-200", text: "text-amber-700", accent: "#F59E0B", node: "border-amber-300" },
  medium_term: { bg: "bg-blue-50/40", border: "border-blue-200", text: "text-blue-700", accent: "#3B82F6", node: "border-blue-300" },
  long_term: { bg: "bg-purple-50/40", border: "border-purple-200", text: "text-purple-700", accent: "#8B5CF6", node: "border-purple-300" },
};

const INFRA_ACTION_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  build: { icon: <Wrench className="h-2.5 w-2.5" />, label: "Build", color: "text-indigo-600" },
  strengthen: { icon: <ArrowUpRight className="h-2.5 w-2.5" />, label: "Strengthen", color: "text-green-600" },
  connect: { icon: <Link2 className="h-2.5 w-2.5" />, label: "Connect", color: "text-blue-600" },
  monitor: { icon: <Gauge className="h-2.5 w-2.5" />, label: "Monitor", color: "text-amber-600" },
  configure: { icon: <Box className="h-2.5 w-2.5" />, label: "Configure", color: "text-purple-600" },
};

const EFFORT_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

const IMPACT_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-700",
  medium: "bg-blue-100 text-blue-700",
  low: "bg-gray-100 text-gray-500",
};

// ── Helpers ──

function resolveEntityName(id: string, entityMap: Map<string, Entity>): string {
  const entity = entityMap.get(id);
  return entity?.name ?? id;
}

/** Parse "C1 -> C5" channel strings into from/to pairs */
function parseChannel(ch: string): { from: string; to: string } | null {
  const parts = ch.split(/\s*(?:->|→|=>)\s*/);
  if (parts.length === 2) return { from: parts[0].trim(), to: parts[1].trim() };
  return null;
}

/** Build a topological sort of tactic IDs using dependencies */
function topoSort(tactics: MicroTactic[]): string[] {
  const idSet = new Set(tactics.map((t) => t.id));
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const t of tactics) {
    adjList.set(t.id, []);
    inDegree.set(t.id, 0);
  }

  // Build graph: dependency entity_id -> which tactic operates on that entity
  // A tactic's dependencies are entity_ids that must be addressed first
  // We link: tactic whose entity_id matches a dependency -> this tactic
  const entityToTactic = new Map<string, string[]>();
  for (const t of tactics) {
    const list = entityToTactic.get(t.entity_id) ?? [];
    list.push(t.id);
    entityToTactic.set(t.entity_id, list);
  }

  for (const t of tactics) {
    for (const depEntityId of t.dependencies) {
      const sourceTactics = entityToTactic.get(depEntityId) ?? [];
      for (const sourceId of sourceTactics) {
        if (sourceId !== t.id && idSet.has(sourceId)) {
          adjList.get(sourceId)?.push(t.id);
          inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
        }
      }
    }
  }

  // Also link by direct tactic id references in dependencies
  for (const t of tactics) {
    for (const depId of t.dependencies) {
      if (idSet.has(depId) && depId !== t.id) {
        if (!adjList.get(depId)?.includes(t.id)) {
          adjList.get(depId)?.push(t.id);
          inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
        }
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    // Sort queue by priority for deterministic ordering
    queue.sort((a, b) => {
      const ta = tactics.find((t) => t.id === a);
      const tb = tactics.find((t) => t.id === b);
      return (ta?.priority ?? 99) - (tb?.priority ?? 99);
    });
    const node = queue.shift()!;
    sorted.push(node);
    for (const next of adjList.get(node) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // Add any remaining (cycle members) at end by priority
  for (const t of tactics) {
    if (!sorted.includes(t.id)) sorted.push(t.id);
  }

  return sorted;
}

// ── Build flow graph ──

function buildFlowGraph(
  recommendation: StrategicRecommendation,
  entityMap: Map<string, Entity>
): { nodes: FlowNode[]; edges: FlowEdge[]; phaseGroups: Map<string, FlowNode[]> } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const phaseGroups = new Map<string, FlowNode[]>();

  const tactics = recommendation.micro_tactics;
  const infraMap = recommendation.infrastructure_map;
  const sortedIds = topoSort(tactics);
  const tacticById = new Map(tactics.map((t) => [t.id, t]));

  // Group by phase
  const phaseGrouped = new Map<string, MicroTactic[]>();
  for (const phase of PHASE_ORDER) {
    phaseGrouped.set(phase, []);
  }
  for (const id of sortedIds) {
    const t = tacticById.get(id);
    if (!t) continue;
    const phase = PHASE_ORDER.includes(t.timeframe) ? t.timeframe : "medium_term";
    phaseGrouped.get(phase)?.push(t);
  }

  let globalRow = 0;

  for (const phase of PHASE_ORDER) {
    const phaseTactics = phaseGrouped.get(phase) ?? [];
    if (phaseTactics.length === 0) continue;

    const phaseNodes: FlowNode[] = [];

    // Compute columns within phase based on dependency depth
    const colMap = new Map<string, number>();
    for (const t of phaseTactics) {
      let maxDepCol = -1;
      for (const depId of t.dependencies) {
        // Check if dependency is a tactic entity
        const depTactics = tactics.filter((dt) => dt.entity_id === depId || dt.id === depId);
        for (const dt of depTactics) {
          if (colMap.has(dt.id)) {
            maxDepCol = Math.max(maxDepCol, colMap.get(dt.id)!);
          }
        }
      }
      colMap.set(t.id, maxDepCol + 1);
    }

    for (const tactic of phaseTactics) {
      const node: FlowNode = {
        id: tactic.id,
        type: "tactic",
        tactic,
        col: colMap.get(tactic.id) ?? 0,
        row: globalRow,
        dependencies: tactic.dependencies,
        unlocks: tactic.channels_established ?? [],
        channels: tactic.channels_established ?? [],
        phase,
      };
      nodes.push(node);
      phaseNodes.push(node);
      globalRow++;
    }

    phaseGroups.set(phase, phaseNodes);
  }

  // Build edges from dependencies
  const entityToTacticId = new Map<string, string[]>();
  for (const t of tactics) {
    const list = entityToTacticId.get(t.entity_id) ?? [];
    list.push(t.id);
    entityToTacticId.set(t.entity_id, list);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const t of tactics) {
    for (const dep of t.dependencies) {
      // Direct tactic id match
      if (nodeIds.has(dep)) {
        edges.push({ from: dep, to: t.id, type: "dependency" });
        continue;
      }
      // Entity id match
      const sourceTactics = entityToTacticId.get(dep) ?? [];
      for (const srcId of sourceTactics) {
        if (srcId !== t.id) {
          edges.push({ from: srcId, to: t.id, type: "dependency" });
        }
      }
    }
  }

  // Build edges from channels_established
  for (const t of tactics) {
    for (const ch of t.channels_established ?? []) {
      const parsed = parseChannel(ch);
      if (!parsed) continue;
      // Find tactics that operate on the target entity
      const targetTactics = entityToTacticId.get(parsed.to) ?? [];
      for (const targetId of targetTactics) {
        if (targetId !== t.id && !edges.some((e) => e.from === t.id && e.to === targetId && e.type === "channel")) {
          edges.push({
            from: t.id,
            to: targetId,
            type: "channel",
            label: `${resolveEntityName(parsed.from, entityMap)} -> ${resolveEntityName(parsed.to, entityMap)}`,
          });
        }
      }
    }
  }

  // Infrastructure channel edges
  if (infraMap?.key_channels) {
    for (const ch of infraMap.key_channels) {
      const fromTactics = entityToTacticId.get(ch.from) ?? [];
      const toTactics = entityToTacticId.get(ch.to) ?? [];
      for (const f of fromTactics) {
        for (const t of toTactics) {
          if (f !== t && !edges.some((e) => e.from === f && e.to === t)) {
            edges.push({
              from: f,
              to: t,
              type: "infrastructure",
              label: ch.description,
            });
          }
        }
      }
    }
  }

  return { nodes, edges, phaseGroups };
}

// ── Main Component ──

export function ExecutionFlowchart({
  recommendation,
  entityMap,
  onTacticClick,
  className,
}: ExecutionFlowchartProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(
    new Set(PHASE_ORDER)
  );
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"flowchart" | "dependency_matrix">("flowchart");

  const { nodes, edges, phaseGroups } = useMemo(
    () => buildFlowGraph(recommendation, entityMap),
    [recommendation, entityMap]
  );

  const infraMap = recommendation.infrastructure_map;
  const temporalPhases = recommendation.temporal_phases;

  // Build a map: tacticId -> set of tactic IDs it depends on (directly)
  const depMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (e.type === "dependency") {
        const set = m.get(e.to) ?? new Set();
        set.add(e.from);
        m.set(e.to, set);
      }
    }
    return m;
  }, [edges]);

  // Build a map: tacticId -> set of tactic IDs it unlocks
  const unlockMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (e.type === "dependency" || e.type === "channel") {
        const set = m.get(e.from) ?? new Set();
        set.add(e.to);
        m.set(e.from, set);
      }
    }
    return m;
  }, [edges]);

  // Highlight connected nodes when one is selected
  const highlightedNodes = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const connected = new Set<string>([selectedNode]);
    for (const e of edges) {
      if (e.from === selectedNode) connected.add(e.to);
      if (e.to === selectedNode) connected.add(e.from);
    }
    return connected;
  }, [selectedNode, edges]);

  const togglePhase = useCallback((phase: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }, []);

  // Count stats
  const totalDependencies = edges.filter((e) => e.type === "dependency").length;
  const totalChannels = edges.filter((e) => e.type === "channel" || e.type === "infrastructure").length;
  const criticalPathLength = useMemo(() => {
    // Find longest dependency chain
    const tacticNodes = nodes.filter((n) => n.type === "tactic");
    const depGraph = new Map<string, string[]>();
    for (const e of edges) {
      if (e.type === "dependency") {
        const list = depGraph.get(e.from) ?? [];
        list.push(e.to);
        depGraph.set(e.from, list);
      }
    }
    let maxLen = 0;
    const memo = new Map<string, number>();
    function dfs(id: string): number {
      if (memo.has(id)) return memo.get(id)!;
      let best = 0;
      for (const next of depGraph.get(id) ?? []) {
        best = Math.max(best, 1 + dfs(next));
      }
      memo.set(id, best);
      return best;
    }
    for (const n of tacticNodes) {
      maxLen = Math.max(maxLen, dfs(n.id));
    }
    return maxLen + 1;
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <div className={cn("rounded-xl border border-gray-200 bg-gray-50/50 p-6 text-center", className)}>
        <Workflow className="h-8 w-8 text-gray-300 mx-auto mb-2" />
        <p className="text-xs text-gray-400">No execution steps to visualize</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* ── Header stats ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <Workflow className="h-3 w-3" />
            <span className="font-semibold">{nodes.length}</span> steps
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <GitBranch className="h-3 w-3" />
            <span className="font-semibold">{totalDependencies}</span> dependencies
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <Link2 className="h-3 w-3" />
            <span className="font-semibold">{totalChannels}</span> channels
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <Layers className="h-3 w-3" />
            <span className="font-semibold">{criticalPathLength}</span> critical path depth
          </div>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {(["flowchart", "dependency_matrix"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[9px] font-medium transition-all",
                viewMode === mode
                  ? "bg-white text-gray-700 shadow-sm"
                  : "text-gray-400 hover:text-gray-600"
              )}
            >
              {mode === "flowchart" ? "Flowchart" : "Dependency Matrix"}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "flowchart" ? (
        <FlowchartView
          phaseGroups={phaseGroups}
          edges={edges}
          expandedPhases={expandedPhases}
          togglePhase={togglePhase}
          selectedNode={selectedNode}
          setSelectedNode={setSelectedNode}
          highlightedNodes={highlightedNodes}
          depMap={depMap}
          unlockMap={unlockMap}
          entityMap={entityMap}
          infraMap={infraMap}
          temporalPhases={temporalPhases}
          onTacticClick={onTacticClick}
        />
      ) : (
        <DependencyMatrixView
          nodes={nodes}
          edges={edges}
          entityMap={entityMap}
        />
      )}

      {/* ── Infrastructure Flow (if present) ── */}
      {infraMap && infraMap.core_components?.length > 0 && (
        <InfrastructureFlowSection
          infraMap={infraMap}
          entityMap={entityMap}
        />
      )}
    </div>
  );
}

// ── Flowchart View ──

function FlowchartView({
  phaseGroups,
  edges,
  expandedPhases,
  togglePhase,
  selectedNode,
  setSelectedNode,
  highlightedNodes,
  depMap,
  unlockMap,
  entityMap,
  infraMap,
  temporalPhases,
  onTacticClick,
}: {
  phaseGroups: Map<string, FlowNode[]>;
  edges: FlowEdge[];
  expandedPhases: Set<string>;
  togglePhase: (phase: string) => void;
  selectedNode: string | null;
  setSelectedNode: (id: string | null) => void;
  highlightedNodes: Set<string>;
  depMap: Map<string, Set<string>>;
  unlockMap: Map<string, Set<string>>;
  entityMap: Map<string, Entity>;
  infraMap?: InfrastructureMap;
  temporalPhases: StrategicRecommendation["temporal_phases"];
  onTacticClick?: (tactic: MicroTactic) => void;
}) {
  return (
    <div className="space-y-2">
      {PHASE_ORDER.map((phase) => {
        const phaseNodes = phaseGroups.get(phase);
        if (!phaseNodes || phaseNodes.length === 0) return null;
        const colors = PHASE_COLORS[phase];
        const isExpanded = expandedPhases.has(phase);
        const temporalPhase = temporalPhases.find(
          (tp) => tp.label.toLowerCase().includes(phase.replace("_", " ")) ||
            phase === "now" && tp.label.toLowerCase().includes("immediate")
        );

        // Count cross-phase dependency arrows coming INTO this phase
        const incomingCrossPhase = edges.filter((e) => {
          const toNode = phaseNodes.find((n) => n.id === e.to);
          const fromNode = [...(phaseGroups.values())].flat().find((n) => n.id === e.from);
          return toNode && fromNode && fromNode.phase !== phase;
        });

        return (
          <div
            key={phase}
            className={cn(
              "rounded-xl border transition-all",
              colors.bg,
              colors.border,
            )}
          >
            {/* Phase header */}
            <button
              onClick={() => togglePhase(phase)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left group"
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${colors.accent}15` }}
                >
                  <Clock className="h-3 w-3" style={{ color: colors.accent }} />
                </div>
                <div>
                  <div className={cn("text-[11px] font-bold uppercase tracking-wider", colors.text)}>
                    {PHASE_LABELS[phase]}
                  </div>
                  {temporalPhase && (
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {temporalPhase.focus}
                    </div>
                  )}
                </div>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-semibold text-gray-600 border border-gray-200">
                  {phaseNodes.length} step{phaseNodes.length !== 1 ? "s" : ""}
                </span>
                {incomingCrossPhase.length > 0 && (
                  <span className="flex items-center gap-0.5 rounded-full bg-white/70 px-1.5 py-0.5 text-[8px] font-medium text-gray-500 border border-gray-200">
                    <ArrowDown className="h-2 w-2" /> {incomingCrossPhase.length} from prior
                  </span>
                )}
                {temporalPhase?.loops_activated?.length ? (
                  <span className="flex items-center gap-0.5 rounded-full bg-blue-100/70 px-1.5 py-0.5 text-[8px] font-medium text-blue-600 border border-blue-200">
                    <RefreshCw className="h-2 w-2" /> {temporalPhase.loops_activated.length} loop{temporalPhase.loops_activated.length !== 1 ? "s" : ""}
                  </span>
                ) : null}
              </div>
              <ChevronDown className={cn("h-4 w-4 text-gray-400 transition-transform", isExpanded && "rotate-180")} />
            </button>

            {/* Phase content */}
            {isExpanded && (
              <div className="px-4 pb-3 space-y-1.5">
                {/* Milestone bar */}
                {temporalPhase && (
                  <div className="flex items-center gap-2 rounded-lg bg-white/60 border border-white px-3 py-1.5 mb-2">
                    <Target className="h-3 w-3 text-green-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider">Milestone: </span>
                      <span className="text-[10px] font-medium text-gray-700">{temporalPhase.milestone}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-gray-400">
                      <Gauge className="h-2.5 w-2.5" /> {temporalPhase.key_metric}
                    </div>
                  </div>
                )}

                {/* Tactic nodes */}
                {phaseNodes.map((node, idx) => {
                  if (!node.tactic) return null;
                  const tactic = node.tactic;
                  const isSelected = selectedNode === node.id;
                  const isHighlighted = highlightedNodes.size === 0 || highlightedNodes.has(node.id);
                  const deps = depMap.get(node.id);
                  const unlocks = unlockMap.get(node.id);
                  const infraAction = tactic.infrastructure_action ? INFRA_ACTION_CONFIG[tactic.infrastructure_action] : null;

                  return (
                    <React.Fragment key={node.id}>
                      {/* Dependency arrow from previous phase */}
                      {idx === 0 && edges.some((e) => {
                        const fromNode = [...(phaseGroups.values())].flat().find((n) => n.id === e.from);
                        return phaseNodes.some((pn) => pn.id === e.to) && fromNode && fromNode.phase !== phase;
                      }) && (
                        <div className="flex justify-center py-0.5">
                          <div className="flex items-center gap-1 text-[8px] text-gray-400">
                            <ArrowDown className="h-3 w-3" />
                            <span>feeds from prior phase</span>
                          </div>
                        </div>
                      )}

                      <div
                        className={cn(
                          "group relative rounded-lg border bg-white px-3 py-2.5 cursor-pointer transition-all",
                          isSelected
                            ? "border-interaxis-400 shadow-md ring-1 ring-interaxis-200"
                            : cn("hover:border-gray-300 hover:shadow-sm", colors.node),
                          !isHighlighted && selectedNode && "opacity-30"
                        )}
                        onClick={() => setSelectedNode(isSelected ? null : node.id)}
                      >
                        {/* Top row: priority + title + badges */}
                        <div className="flex items-start gap-2.5">
                          <span
                            className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white flex-shrink-0 mt-0.5"
                            style={{ backgroundColor: colors.accent }}
                          >
                            {tactic.priority}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-gray-800 leading-tight">
                                {tactic.title}
                              </span>
                              {infraAction && (
                                <span className={cn("flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[8px] font-medium bg-indigo-50", infraAction.color)}>
                                  {infraAction.icon} {infraAction.label}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[10px] text-gray-500 leading-relaxed line-clamp-2">
                              {tactic.description}
                            </p>

                            {/* Entity + effort/impact row */}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-medium text-gray-600">
                                <Circle className="h-2 w-2" style={{ color: colors.accent, fill: colors.accent }} />
                                {tactic.entity_name}
                              </span>
                              <span className={cn("rounded px-1 py-0.5 text-[8px] font-medium", EFFORT_COLORS[tactic.effort])}>
                                {tactic.effort} effort
                              </span>
                              <span className={cn("rounded px-1 py-0.5 text-[8px] font-medium", IMPACT_COLORS[tactic.impact])}>
                                {tactic.impact} impact
                              </span>
                            </div>

                            {/* Dependency arrows */}
                            {deps && deps.size > 0 && (
                              <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                                <span className="text-[8px] text-gray-400 font-medium uppercase tracking-wider">Requires:</span>
                                {[...deps].map((depId) => {
                                  const depNodes = [...(phaseGroups.values())].flat();
                                  const depNode = depNodes.find((n) => n.id === depId);
                                  return (
                                    <button
                                      key={depId}
                                      onClick={(e) => { e.stopPropagation(); setSelectedNode(depId); }}
                                      className="flex items-center gap-0.5 rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-[8px] font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                                    >
                                      <ArrowRight className="h-2 w-2 text-gray-400" />
                                      {depNode?.tactic?.title ?? depId}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Unlocks / channels established */}
                            {unlocks && unlocks.size > 0 && (
                              <div className="mt-1 flex items-center gap-1 flex-wrap">
                                <span className="text-[8px] text-green-600 font-medium uppercase tracking-wider">Unlocks:</span>
                                {[...unlocks].map((unlockId) => {
                                  const allNodes = [...(phaseGroups.values())].flat();
                                  const unlockNode = allNodes.find((n) => n.id === unlockId);
                                  return (
                                    <button
                                      key={unlockId}
                                      onClick={(e) => { e.stopPropagation(); setSelectedNode(unlockId); }}
                                      className="flex items-center gap-0.5 rounded bg-green-50 border border-green-200 px-1.5 py-0.5 text-[8px] font-medium text-green-700 hover:bg-green-100 transition-colors"
                                    >
                                      <ArrowUpRight className="h-2 w-2" />
                                      {unlockNode?.tactic?.title ?? unlockId}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Channels established */}
                            {tactic.channels_established && tactic.channels_established.length > 0 && (
                              <div className="mt-1 flex items-center gap-1 flex-wrap">
                                <span className="text-[8px] text-blue-500 font-medium uppercase tracking-wider">Channels:</span>
                                {tactic.channels_established.map((ch, ci) => {
                                  const parsed = parseChannel(ch);
                                  if (!parsed) return (
                                    <span key={ci} className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[8px] text-blue-600">{ch}</span>
                                  );
                                  return (
                                    <span key={ci} className="flex items-center gap-0.5 rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[8px] text-blue-600">
                                      {resolveEntityName(parsed.from, entityMap)}
                                      <ArrowRight className="h-2 w-2" />
                                      {resolveEntityName(parsed.to, entityMap)}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {/* Implementation intention */}
                            {tactic.implementation_intention && isSelected && (
                              <div className="mt-2 rounded border border-blue-100 bg-blue-50/30 px-2 py-1.5">
                                <span className="text-[8px] font-semibold text-blue-500 uppercase">When/If then</span>
                                <p className="text-[10px] text-blue-800 mt-0.5 leading-relaxed">
                                  <span className="text-blue-500">When </span>
                                  {tactic.implementation_intention.trigger}
                                  <span className="text-blue-500"> then </span>
                                  {tactic.implementation_intention.action}
                                </p>
                              </div>
                            )}

                            {/* Metric */}
                            {isSelected && (
                              <div className="mt-1.5 flex items-center gap-1 text-[9px] text-gray-400">
                                <Target className="h-2.5 w-2.5" />
                                <span>{tactic.metric.name}: {tactic.metric.target}{tactic.metric.unit ? ` ${tactic.metric.unit}` : ""}</span>
                              </div>
                            )}
                          </div>

                          {/* Right side: click-to-expand icon */}
                          <button
                            onClick={(e) => { e.stopPropagation(); onTacticClick?.(tactic); }}
                            className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Connector line between nodes in same phase */}
                      {idx < phaseNodes.length - 1 && (
                        <div className="flex justify-center">
                          <div className="h-2 w-px" style={{ backgroundColor: `${colors.accent}30` }} />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Loops activated in this phase */}
                {temporalPhase?.loops_activated?.length ? (
                  <div className="mt-2 rounded-lg bg-blue-50/50 border border-blue-100 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[9px] font-semibold text-blue-600 uppercase tracking-wider mb-1">
                      <RefreshCw className="h-2.5 w-2.5" /> Loops Activated
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {temporalPhase.loops_activated.map((loop, li) => (
                        <span key={li} className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-medium text-blue-700">
                          {loop}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Infrastructure deployed in this phase */}
                {temporalPhase?.infrastructure_deployed?.length ? (
                  <div className="mt-1 rounded-lg bg-indigo-50/50 border border-indigo-100 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[9px] font-semibold text-indigo-600 uppercase tracking-wider mb-1">
                      <Box className="h-2.5 w-2.5" /> Infrastructure Deployed
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {temporalPhase.infrastructure_deployed.map((comp, ci) => (
                        <span key={ci} className="rounded-full bg-indigo-100 px-2 py-0.5 text-[9px] font-medium text-indigo-700">
                          {comp}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Dependency Matrix View ──

function DependencyMatrixView({
  nodes,
  edges,
  entityMap,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  entityMap: Map<string, Entity>;
}) {
  const tacticNodes = nodes.filter((n) => n.type === "tactic" && n.tactic);

  if (tacticNodes.length === 0) return null;

  // Build adjacency for dependency edges
  const depSet = new Set(
    edges
      .filter((e) => e.type === "dependency")
      .map((e) => `${e.from}|${e.to}`)
  );
  const channelSet = new Set(
    edges
      .filter((e) => e.type === "channel" || e.type === "infrastructure")
      .map((e) => `${e.from}|${e.to}`)
  );

  return (
    <div className="overflow-x-auto">
      <div className="text-[9px] text-gray-400 mb-2">
        Rows depend on columns. <span className="inline-block h-2 w-2 rounded-sm bg-red-400 align-middle mx-0.5" /> = dependency, <span className="inline-block h-2 w-2 rounded-sm bg-blue-400 align-middle mx-0.5" /> = channel
      </div>
      <table className="border-collapse text-[9px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white z-10 px-2 py-1 text-left text-gray-500 font-medium border-b border-r border-gray-200 min-w-[120px]">
              Step
            </th>
            {tacticNodes.map((n) => (
              <th
                key={n.id}
                className="px-1 py-1 text-center font-medium text-gray-500 border-b border-gray-200 min-w-[28px] max-w-[28px]"
                title={n.tactic?.title}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[8px] font-bold mx-auto">
                  {n.tactic?.priority ?? "?"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tacticNodes.map((row) => {
            const rowPhase = PHASE_COLORS[row.phase];
            return (
              <tr key={row.id} className="hover:bg-gray-50/50">
                <td className="sticky left-0 bg-white z-10 px-2 py-1.5 text-left text-gray-700 font-medium border-r border-b border-gray-200 max-w-[200px] truncate">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: rowPhase?.accent ?? "#888" }}
                    >
                      {row.tactic?.priority}
                    </span>
                    <span className="truncate">{row.tactic?.title}</span>
                  </div>
                </td>
                {tacticNodes.map((col) => {
                  const key = `${col.id}|${row.id}`;
                  const isDep = depSet.has(key);
                  const isChannel = channelSet.has(key);
                  const isSelf = row.id === col.id;
                  return (
                    <td
                      key={col.id}
                      className={cn(
                        "text-center border-b border-gray-100 min-w-[28px] max-w-[28px]",
                        isSelf && "bg-gray-100"
                      )}
                    >
                      {isSelf ? (
                        <span className="text-gray-300">-</span>
                      ) : isDep ? (
                        <span className="inline-block h-3 w-3 rounded-sm bg-red-400" title="dependency" />
                      ) : isChannel ? (
                        <span className="inline-block h-3 w-3 rounded-sm bg-blue-400" title="channel" />
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Infrastructure Flow Section ──

function InfrastructureFlowSection({
  infraMap,
  entityMap,
}: {
  infraMap: InfrastructureMap;
  entityMap: Map<string, Entity>;
}) {
  const [expanded, setExpanded] = useState(false);

  const components = infraMap.core_components ?? [];
  const channels = infraMap.key_channels ?? [];
  const loops = infraMap.activated_loops ?? [];

  if (components.length === 0) return null;

  const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    exists: { bg: "bg-green-100", text: "text-green-700", label: "Active" },
    needs_strengthening: { bg: "bg-amber-100", text: "text-amber-700", label: "Strengthen" },
    needs_building: { bg: "bg-red-100", text: "text-red-700", label: "Build" },
  };

  const roleIcons: Record<string, React.ReactNode> = {
    hub: <Radio className="h-3 w-3" />,
    input: <ArrowRight className="h-3 w-3 rotate-180" />,
    output: <ArrowRight className="h-3 w-3" />,
    processor: <Workflow className="h-3 w-3" />,
    monitor: <Gauge className="h-3 w-3" />,
    gate: <Shield className="h-3 w-3" />,
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/20">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-left group"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-indigo-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
            Infrastructure Architecture
          </span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[9px] font-semibold text-indigo-600">
            {components.length} components
          </span>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-600">
            {channels.length} channels
          </span>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-indigo-400 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Components grid */}
          <div className="grid grid-cols-2 gap-2">
            {components.map((comp, i) => {
              const status = statusColors[comp.status] ?? statusColors.exists;
              return (
                <div
                  key={i}
                  className="rounded-lg border border-indigo-100 bg-white px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-indigo-500">
                      {roleIcons[comp.role] ?? <Box className="h-3 w-3" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-gray-800 truncate">
                          {comp.entity_name}
                        </span>
                        <span className={cn("rounded px-1 py-0.5 text-[7px] font-bold uppercase", status.bg, status.text)}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-[9px] text-gray-500 mt-0.5 line-clamp-1">{comp.description}</p>
                    </div>
                  </div>

                  {/* Receives from / Produces for */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {comp.receives_from?.map((rid) => (
                      <span key={`r-${rid}`} className="flex items-center gap-0.5 rounded bg-gray-50 px-1 py-0.5 text-[7px] text-gray-500">
                        <ArrowRight className="h-1.5 w-1.5 rotate-180" />
                        {resolveEntityName(rid, entityMap)}
                      </span>
                    ))}
                    {comp.produces_for?.map((pid) => (
                      <span key={`p-${pid}`} className="flex items-center gap-0.5 rounded bg-green-50 px-1 py-0.5 text-[7px] text-green-600">
                        <ArrowRight className="h-1.5 w-1.5" />
                        {resolveEntityName(pid, entityMap)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Key channels */}
          {channels.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Key Channels
              </div>
              <div className="space-y-1">
                {channels.map((ch, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-white border border-gray-100 px-3 py-1.5">
                    <span className="text-[9px] font-medium text-gray-700">
                      {resolveEntityName(ch.from, entityMap)}
                    </span>
                    <div className="flex items-center gap-1">
                      <div className={cn(
                        "h-px flex-1 min-w-[20px]",
                        ch.exists ? "bg-green-400" : "bg-gray-300 border-dashed border-t border-gray-300 bg-transparent"
                      )} />
                      <span className={cn(
                        "rounded px-1 py-0.5 text-[7px] font-medium",
                        ch.exists ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-500"
                      )}>
                        {ch.channel_type.replace("_", " ")}
                      </span>
                      <ArrowRight className="h-2.5 w-2.5 text-gray-400" />
                    </div>
                    <span className="text-[9px] font-medium text-gray-700">
                      {resolveEntityName(ch.to, entityMap)}
                    </span>
                    {!ch.exists && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[7px] font-medium text-amber-600">needs building</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activated loops */}
          {loops.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Feedback Loops
              </div>
              <div className="flex flex-wrap gap-1.5">
                {loops.map((loop, i) => (
                  <div key={i} className="rounded-lg border border-blue-100 bg-blue-50/50 px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <RefreshCw className="h-2.5 w-2.5 text-blue-500" />
                      <span className="text-[9px] font-semibold text-blue-700">{loop.name}</span>
                    </div>
                    <p className="text-[8px] text-blue-600 mt-0.5">{loop.role_in_strategy}</p>
                    <span className="text-[7px] text-blue-400 mt-0.5 block">Phase: {loop.activation_phase}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
