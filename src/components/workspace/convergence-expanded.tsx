"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Finding } from "@/types/finding";
import type { ConvergenceInsight, ConvergenceDepth } from "@/types/interactions";
import type { Entity } from "@/types";

const DEPTH_CONFIG: Record<ConvergenceDepth, {
  color: string;
  bg: string;
  border: string;
  badge: string;
  label: string;
  valueLabel: string;
}> = {
  L4: { color: "#007AFF", bg: "rgba(0,122,255,0.04)", border: "rgba(0,122,255,0.25)", badge: "#007AFF", label: "L4 · INVARIANT", valueLabel: "First-principle — highest structural value" },
  L3: { color: "#F59E0B", bg: "rgba(245,158,11,0.04)", border: "rgba(245,158,11,0.25)", badge: "#F59E0B", label: "L3 · LOGIC", valueLabel: "Shared logical fundamental" },
  L2: { color: "#8B5CF6", bg: "rgba(139,92,246,0.04)", border: "rgba(139,92,246,0.25)", badge: "#8B5CF6", label: "L2 · METHOD", valueLabel: "Shared causal mechanism" },
  L1: { color: "#6B7280", bg: "rgba(107,114,128,0.03)", border: "rgba(107,114,128,0.2)", badge: "#6B7280", label: "L1 · OUTCOME", valueLabel: "Shared outcome — most common" },
};

interface ConvergenceExpandedProps {
  finding: Finding;
  entities: Entity[];
  onBack: () => void;
}

/**
 * Expanded convergence gallery view for a single finding.
 * Shows two strategies side-by-side with their decomposition paths
 * converging at the shared element (matching Mockup 3).
 */
export function ConvergenceExpanded({
  finding,
  entities,
  onBack,
}: ConvergenceExpandedProps) {
  const conv = finding.convergence_data;
  if (!conv) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-20">
        <p className="text-sm text-gray-400">No convergence data available for this finding.</p>
        <button onClick={onBack} className="mt-3 text-xs font-semibold text-blue-600 hover:text-blue-800">
          ← Back to findings
        </button>
      </div>
    );
  }

  const dc = DEPTH_CONFIG[conv.depth];
  const entityById = new Map<string, Entity>();
  for (const e of entities) {
    entityById.set(e.id, e);
    if (e.entity_id) entityById.set(e.entity_id, e);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-200 px-7 py-4">
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800"
        >
          <ArrowLeft className="h-3 w-3" /> Back to findings
        </button>
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-bold text-white"
            style={{ background: dc.badge }}
          >
            {dc.label}
          </span>
          <span className="text-xs text-gray-400">{dc.valueLabel}</span>
        </div>
        <h2 className="text-lg font-bold text-gray-900">{finding.title}</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-gray-50/60 px-7 py-5">
        {/* Strategy comparison */}
        <div className="mb-6">
          <div className={cn(
            "grid gap-4",
            conv.converging_branches.length === 2 ? "grid-cols-2" : "grid-cols-1",
          )}>
            {conv.converging_branches.map((branch, i) => {
              const branchEntity = entityById.get(branch.entity_id);
              return (
                <StrategyColumn
                  key={branch.entity_id}
                  label={`Strategy ${String.fromCharCode(65 + i)}`}
                  domain={branch.category}
                  branchName={branch.name}
                  branchEntity={branchEntity}
                  pathEntityIds={branch.path_to_shared}
                  entityById={entityById}
                  depth={conv.depth}
                />
              );
            })}
          </div>

          {/* Convergence indicator */}
          <div className="my-5 flex items-center gap-2">
            <div className="flex-1 h-px" style={{ background: dc.border }} />
            <span
              className="rounded-full px-4 py-1.5 text-[11px] font-bold text-white shadow-sm"
              style={{ background: dc.badge }}
            >
              CONVERGES AT {conv.depth}
            </span>
            <div className="flex-1 h-px" style={{ background: dc.border }} />
          </div>

          {/* Shared element card */}
          <div
            className="rounded-xl border-2 bg-white p-5"
            style={{ borderColor: dc.color }}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className="rounded px-2 py-0.5 text-[9px] font-bold text-white"
                style={{ background: dc.badge }}
              >
                {conv.depth_label.toUpperCase()}
              </span>
              <span className="text-[10px] font-medium text-gray-400">
                shared element &middot; {conv.shared_element.category}
              </span>
            </div>
            <h3 className="text-lg font-bold text-gray-900">
              {conv.shared_element.name}
            </h3>
            {conv.explanation && (
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                {conv.explanation}
              </p>
            )}
          </div>
        </div>

        {/* Why this matters footer */}
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: dc.border, background: dc.bg }}
        >
          <p className="text-sm text-gray-800 leading-relaxed">
            <strong style={{ color: dc.color }}>Why this matters.</strong>{" "}
            Both strategies are downstream expressions of the same{" "}
            {conv.depth === "L4" ? "cognitive constraint" : conv.depth === "L3" ? "logical fundamental" : "shared mechanism"}.
            Encoding this as a design rule strengthens both strategies simultaneously.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">
              Open in graph →
            </button>
            <button className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Strategy column ──

function StrategyColumn({
  label,
  domain,
  branchName,
  branchEntity,
  pathEntityIds,
  entityById,
  depth,
}: {
  label: string;
  domain: string;
  branchName: string;
  branchEntity: Entity | undefined;
  pathEntityIds: string[];
  entityById: Map<string, Entity>;
  depth: ConvergenceDepth;
}) {
  const DOMAIN_COLORS: Record<string, { bg: string; text: string }> = {
    concrete: { bg: "rgba(59,130,246,0.12)", text: "#1E40AF" },
    abstract: { bg: "rgba(139,92,246,0.12)", text: "#5B21B6" },
    process: { bg: "rgba(16,185,129,0.12)", text: "#065F46" },
    relational: { bg: "rgba(249,115,22,0.12)", text: "#9A3412" },
    epistemic: { bg: "rgba(236,72,153,0.12)", text: "#9D174D" },
  };
  const domainColor = DOMAIN_COLORS[domain] ?? { bg: "rgba(0,0,0,0.06)", text: "#48484A" };

  // Resolve path entities for decomposition display
  const pathEntities = pathEntityIds
    .map((id) => entityById.get(id))
    .filter((e): e is Entity => e !== undefined && e.id !== pathEntityIds[pathEntityIds.length - 1]);

  // Map entity importance to display layer
  const importanceToLayer = (imp: string): string => {
    switch (imp) {
      case "fundamental": return "L1 · OUTCOME";
      case "critical": return "L2 · METHOD";
      case "important": return "L3 · LOGIC";
      default: return "L4 · ATOM";
    }
  };

  return (
    <div className="rounded-xl border border-blue-100 bg-white/70 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded-full px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider"
          style={{ background: domainColor.bg, color: domainColor.text }}
        >
          {domain}
        </span>
        <span className="text-[13px] font-bold text-gray-900">{label}</span>
      </div>
      <p className="mb-3 text-[11px] text-gray-500">{branchName}</p>

      {/* Decomposition layers */}
      <div className="space-y-2">
        {pathEntities.length > 0 ? (
          pathEntities.map((entity, i) => (
            <div
              key={entity.id}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2"
            >
              <div className="mb-0.5 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{
                  background: entity.importance === "fundamental" ? "#6B7280"
                    : entity.importance === "critical" ? "#8B5CF6"
                    : entity.importance === "important" ? "#F59E0B"
                    : "#007AFF",
                }} />
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                  {importanceToLayer(entity.importance ?? "moderate")}
                </span>
              </div>
              <p className="text-xs font-semibold text-gray-800">{entity.name}</p>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center">
            <p className="text-[11px] text-gray-400">Path details not available</p>
          </div>
        )}
      </div>
    </div>
  );
}
