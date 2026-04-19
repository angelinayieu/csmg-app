"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  X,
  ArrowRight,
  AlertTriangle,
  Zap,
  Network,
  Eye,
  EyeOff,
  Sparkles,
  ShieldAlert,
  GitBranch,
} from "lucide-react";
import type {
  ProbabilitySpace,
  ProbabilityNode,
  ProbabilityEdge,
  SpaceIntersection,
} from "@/types/probability-space";

// ── Probability Space Panel ──
// Shows the expanded probability space for a selected edge

interface ProbabilitySpacePanelProps {
  space: ProbabilitySpace;
  onClose: () => void;
}

function nodeTypeIcon(type: ProbabilityNode["type"]) {
  switch (type) {
    case "sub_component": return <GitBranch className="h-3 w-3 text-blue-500" />;
    case "mediator": return <Network className="h-3 w-3 text-amber-500" />;
    case "condition": return <ShieldAlert className="h-3 w-3 text-blue-500" />;
    case "pathway_junction": return <Zap className="h-3 w-3 text-purple-500" />;
  }
}

function controllabilityBadge(ctrl?: string) {
  if (!ctrl) return null;
  const config: Record<string, { bg: string; text: string }> = {
    direct: { bg: "bg-green-100", text: "text-green-700" },
    indirect: { bg: "bg-amber-100", text: "text-amber-700" },
    uncontrollable: { bg: "bg-red-100", text: "text-red-700" },
  };
  const c = config[ctrl] ?? config.indirect;
  return (
    <span className={cn("rounded px-1 py-0.5 text-[8px] font-medium", c.bg, c.text)}>
      {ctrl}
    </span>
  );
}

function visibilityIcon(vis?: string) {
  if (!vis) return null;
  if (vis === "observable") return <Eye className="h-2.5 w-2.5 text-green-500" />;
  if (vis === "latent") return <EyeOff className="h-2.5 w-2.5 text-amber-500" />;
  return <EyeOff className="h-2.5 w-2.5 text-red-500" />;
}

function qualityTierBadge(tier?: ProbabilitySpace["quality_tier"]) {
  const t = tier ?? "estimated";
  const label =
    t === "verified" ? "Well-researched"
    : t === "speculative" ? "Early stage"
    : "Partially researched";
  const tooltip =
    t === "verified"
      ? "This pathway has mostly grounded, research-backed data."
      : t === "speculative"
        ? "This pathway needs more research to reveal its internal structure."
        : "This pathway has some researched data mixed with estimates.";
  const cls =
    t === "verified"
      ? "bg-green-100 text-green-700"
      : t === "speculative"
        ? "bg-gray-100 text-gray-600"
        : "bg-amber-100 text-amber-700";
  return (
    <span title={tooltip} className={cn("rounded px-1.5 py-0.5 text-[8px] font-medium", cls)}>
      {label}
    </span>
  );
}

function probabilitySourceBadge(src?: ProbabilityEdge["probability_source"]) {
  const s = src ?? "estimated";
  const tooltip =
    s === "measured"
      ? "Measured: derived from explicit validated values."
      : s === "default"
        ? "Default: fallback value used due to missing empirical input."
        : "Estimated: inferred from structured expansion data.";
  const cls =
    s === "measured"
      ? "bg-green-100 text-green-700"
      : s === "default"
        ? "bg-gray-100 text-gray-600"
        : "bg-amber-100 text-amber-700";
  return (
    <span title={tooltip} className={cn("rounded px-1 py-0.5 text-[7px] font-medium uppercase", cls)}>
      {s}
    </span>
  );
}

export function ProbabilitySpacePanel({ space, onClose }: ProbabilitySpacePanelProps) {
  // Group nodes by parent entity
  const sourceNodes = useMemo(
    () => space.nodes.filter((n) => n.parent_entity_id === space.source_entity_id),
    [space]
  );
  const targetNodes = useMemo(
    () => space.nodes.filter((n) => n.parent_entity_id === space.target_entity_id),
    [space]
  );

  // Cross-entity bridges
  const crossBridges = useMemo(
    () => space.edges.filter((e) => e.edge_type === "cross_entity_bridge"),
    [space]
  );

  const hasDefaultProbabilities = useMemo(
    () => space.edges.some((e) => e.probability_source === "default"),
    [space]
  );

  // Critical path node set
  const criticalPathSet = useMemo(
    () => new Set(space.critical_path),
    [space]
  );

  const probColor = (p: number) =>
    p >= 0.7 ? "text-green-600" : p >= 0.4 ? "text-amber-600" : "text-red-600";

  const probBg = (p: number) =>
    p >= 0.7 ? "bg-green-50 border-green-200" : p >= 0.4 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";

  return (
    <div className="rounded-xl border border-blue-200 bg-white shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-purple-50 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Network className="h-4 w-4 text-blue-500 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">
              Probability Space
            </div>
            <div className="text-[10px] text-gray-600 truncate">
              {space.source_entity_name} → {space.target_entity_name}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {qualityTierBadge(space.quality_tier)}
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium border",
            space.nodes.length >= 4 ? "bg-blue-50 border-blue-200 text-blue-700" :
            space.nodes.length >= 3 ? "bg-gray-50 border-gray-200 text-gray-600" :
            "bg-gray-50 border-gray-200 text-gray-500"
          )}>
            {space.nodes.length} factors
          </span>
          <button onClick={onClose} className="rounded p-1 hover:bg-blue-100 transition-colors">
            <X className="h-3.5 w-3.5 text-gray-400" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {hasDefaultProbabilities && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[9px] text-gray-600">
            Some probabilities are labeled <span className="font-semibold">default</span> because explicit source values were unavailable.
          </div>
        )}
        {/* Flow visualization: Source → Cross Bridges → Target */}
        <div className="flex gap-3">
          {/* Source side */}
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-blue-500 mb-1.5">
              {space.source_entity_name}
            </div>
            <div className="space-y-1">
              {sourceNodes.map((node) => (
                <div
                  key={node.id}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 transition-colors",
                    criticalPathSet.has(node.id)
                      ? "border-blue-300 bg-blue-50/50 ring-1 ring-blue-200"
                      : "border-gray-200 bg-gray-50/50"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {nodeTypeIcon(node.type)}
                    <span className="text-[10px] font-medium text-gray-800 truncate">{node.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {node.probability != null && (
                      <span className={cn("text-[9px] font-medium", probColor(node.probability))}>
                        {Math.round(node.probability * 100)}%
                      </span>
                    )}
                    {controllabilityBadge(node.controllability)}
                    {visibilityIcon(node.visibility)}
                    {node.importance === "critical" && (
                      <span className="rounded bg-red-100 px-1 py-0.5 text-[7px] font-bold text-red-600">CRIT</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cross-entity bridges (center column) */}
          {crossBridges.length > 0 && (
            <div className="flex flex-col items-center justify-center gap-1.5 px-1">
              {crossBridges.map((bridge, i) => {
                const srcNode = space.nodes.find((n) => n.id === bridge.source_id);
                const tgtNode = space.nodes.find((n) => n.id === bridge.target_id);
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-amber-200 bg-amber-50/40 px-2 py-1.5 text-center"
                  >
                    <div className="flex items-center gap-1 text-[8px] text-amber-700">
                      <span className="truncate max-w-[60px]">{srcNode?.name ?? "?"}</span>
                      <ArrowRight className="h-2.5 w-2.5 flex-shrink-0" />
                      <span className="truncate max-w-[60px]">{tgtNode?.name ?? "?"}</span>
                    </div>
                    <div className={cn("text-[9px] font-medium mt-0.5", probColor(bridge.probability))}>
                      {Math.round(bridge.probability * 100)}%
                    </div>
                    <div className="mt-0.5 flex justify-center">
                      {probabilitySourceBadge(bridge.probability_source)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Target side */}
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-purple-500 mb-1.5">
              {space.target_entity_name}
            </div>
            <div className="space-y-1">
              {targetNodes.map((node) => (
                <div
                  key={node.id}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 transition-colors",
                    criticalPathSet.has(node.id)
                      ? "border-blue-300 bg-blue-50/50 ring-1 ring-blue-200"
                      : "border-gray-200 bg-gray-50/50"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {nodeTypeIcon(node.type)}
                    <span className="text-[10px] font-medium text-gray-800 truncate">{node.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {node.probability != null && (
                      <span className={cn("text-[9px] font-medium", probColor(node.probability))}>
                        {Math.round(node.probability * 100)}%
                      </span>
                    )}
                    {controllabilityBadge(node.controllability)}
                    {visibilityIcon(node.visibility)}
                    {node.importance === "critical" && (
                      <span className="rounded bg-red-100 px-1 py-0.5 text-[7px] font-bold text-red-600">CRIT</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Critical Path */}
        {space.critical_path.length > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-blue-600 mb-1.5">
              Critical Path
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {space.critical_path.map((nodeId, i) => {
                const node = space.nodes.find((n) => n.id === nodeId);
                return (
                  <React.Fragment key={nodeId}>
                    {i > 0 && <ArrowRight className="h-2.5 w-2.5 text-blue-300 flex-shrink-0" />}
                    <span className="rounded-lg bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
                      {node?.name ?? nodeId.split("_").pop()}
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Failure Points */}
        {space.failure_points.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50/30 p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-red-600 mb-1.5">
              <AlertTriangle className="inline h-3 w-3 mr-0.5" />
              Failure Points ({space.failure_points.length})
            </div>
            <div className="space-y-1">
              {space.failure_points.map((fp, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px]">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <span className={cn(
                        "rounded px-1 py-0.5 text-[8px] font-medium flex-shrink-0",
                        fp.blast_radius === "systemic" ? "bg-red-200 text-red-800" :
                        fp.blast_radius === "cascading" ? "bg-amber-200 text-amber-800" :
                        "bg-gray-200 text-gray-700"
                      )}>
                        {fp.blast_radius}
                      </span>
                      {fp.goal_aware && (
                        <span className="rounded bg-blue-100 px-1 py-0.5 text-[7px] font-medium uppercase text-blue-700">
                          goal-aware
                        </span>
                      )}
                    </div>
                    <span className="text-gray-700">{fp.node_name}: {fp.failure_mode}</span>
                    {fp.classification_rationale && (
                      <span className="text-[8px] text-gray-500">{fp.classification_rationale}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conditions Summary */}
        {space.conditions_summary.length > 0 && (
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Active Conditions
            </div>
            <div className="flex flex-wrap gap-1">
              {space.conditions_summary.map((cond, i) => (
                <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-600">
                  {cond}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Intersection Card ──

interface IntersectionCardProps {
  intersection: SpaceIntersection;
  onExpand?: (edgeId: string) => void;
}

export function IntersectionCard({ intersection, onExpand }: IntersectionCardProps) {
  const potentialColor =
    intersection.innovation_potential === "high" ? "border-green-300 bg-green-50/30" :
    intersection.innovation_potential === "medium" ? "border-amber-300 bg-amber-50/30" :
    "border-gray-200 bg-gray-50/30";

  const potentialBadge =
    intersection.innovation_potential === "high" ? "bg-green-100 text-green-700" :
    intersection.innovation_potential === "medium" ? "bg-amber-100 text-amber-700" :
    "bg-gray-100 text-gray-600";

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", potentialColor)}>
      {/* Header: two spaces + innovation badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-[10px]">
            <span className="font-medium text-blue-700 truncate">{intersection.space_a_label}</span>
            <span className="text-gray-400">×</span>
            <span className="font-medium text-purple-700 truncate">{intersection.space_b_label}</span>
          </div>
        </div>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-semibold flex-shrink-0", potentialBadge)}>
          <Sparkles className="inline h-2.5 w-2.5 mr-0.5" />
          {intersection.innovation_potential}
        </span>
      </div>

      {/* Shared nodes */}
      <div className="flex flex-wrap gap-1">
        {intersection.shared_nodes.map((sn, i) => (
          <span key={i} className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
            {sn.name}
            <span className="text-blue-400 ml-0.5">{Math.round(sn.similarity * 100)}%</span>
          </span>
        ))}
      </div>

      {/* Insight */}
      <p className="text-[10px] text-gray-600 leading-relaxed">{intersection.insight}</p>

      {/* Scores */}
      <div className="flex items-center gap-3 text-[9px]">
        <div className="flex items-center gap-1">
          <span className="text-gray-400">Novelty</span>
          <div className="h-1 w-12 rounded-full bg-gray-100">
            <div className="h-1 rounded-full bg-blue-400" style={{ width: `${intersection.novelty_score * 100}%` }} />
          </div>
          <span className="font-medium text-gray-600">{Math.round(intersection.novelty_score * 100)}%</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-400">Impact</span>
          <div className="h-1 w-12 rounded-full bg-gray-100">
            <div className="h-1 rounded-full bg-amber-400" style={{ width: `${intersection.impact_score * 100}%` }} />
          </div>
          <span className="font-medium text-gray-600">{Math.round(intersection.impact_score * 100)}%</span>
        </div>
        {onExpand && (
          <button
            onClick={() => onExpand(intersection.space_a_edge_id)}
            className="ml-auto rounded px-1.5 py-0.5 text-[8px] font-medium bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"
          >
            Expand space →
          </button>
        )}
      </div>
    </div>
  );
}

// ── Probability Spaces Summary Section ──
// Used in the intelligence radar module to show all computed spaces + intersections

interface ProbabilitySpacesSectionProps {
  spaces: ProbabilitySpace[];
  intersections: SpaceIntersection[];
  onExpandSpace: (edgeId: string) => void;
  expandedEdgeId: string | null;
  loading?: boolean;
}

export function ProbabilitySpacesSection({
  spaces,
  intersections,
  onExpandSpace,
  expandedEdgeId,
  loading = false,
}: ProbabilitySpacesSectionProps) {
  // Sort spaces by total pathway probability (lowest first = most interesting)
  const sortedSpaces = useMemo(
    () => [...spaces].sort((a, b) => a.total_pathway_probability - b.total_pathway_probability),
    [spaces]
  );

  if (spaces.length === 0 && !loading) return null;

  return (
    <div className="space-y-3">
      {/* Intersections removed from this section — shown separately in the module */}

      {/* Space list (compact) */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
          Edge Probability Spaces ({spaces.length})
        </div>
        <div className="space-y-1">
          {sortedSpaces.slice(0, 10).map((space) => {
            const isExpanded = expandedEdgeId === space.edge_id;
            return (
              <button
                key={space.id}
                onClick={() => onExpandSpace(space.edge_id)}
                className={cn(
                  "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                  isExpanded
                    ? "border-blue-300 bg-blue-50"
                    : "border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/30"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Network className="h-3 w-3 text-blue-400 flex-shrink-0" />
                    <span className="text-[10px] font-medium text-gray-700 truncate">
                      {space.source_entity_name}
                    </span>
                    <ArrowRight className="h-2.5 w-2.5 text-gray-300 flex-shrink-0" />
                    <span className="text-[10px] font-medium text-gray-700 truncate">
                      {space.target_entity_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[9px] font-medium text-gray-500">
                      {space.nodes.length}n
                    </span>
                    {qualityTierBadge(space.quality_tier)}
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                      space.total_pathway_probability >= 0.7 ? "bg-green-100 text-green-700" :
                      space.total_pathway_probability >= 0.4 ? "bg-amber-100 text-amber-700" :
                      "bg-red-100 text-red-700"
                    )}>
                      {Math.round(space.total_pathway_probability * 100)}%
                    </span>
                    {space.failure_points.length > 0 && (
                      <AlertTriangle className="h-3 w-3 text-red-400" />
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-transparent" />
          Computing probability spaces...
        </div>
      )}
    </div>
  );
}
