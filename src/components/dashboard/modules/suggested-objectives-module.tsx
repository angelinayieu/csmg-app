"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Target,
  TrendingUp,
  TrendingDown,
  Shield,
  Search,
  AlertOctagon,
  ChevronRight,
  Check,
  X,
  Sparkles,
  Globe,
  BarChart3,
  Activity,
} from "lucide-react";
import type { SuggestedObjective, ObjectiveType } from "@/types/goals";
import type { PreliminaryObjective } from "@/types/epistemic";

interface SuggestedObjectivesModuleProps {
  objectives: SuggestedObjective[];
  onAccept: (objective: SuggestedObjective) => void;
  onDismiss: (key: string) => void;
  preliminaryObjectives?: PreliminaryObjective[];
}

const objectiveConfig: Record<
  ObjectiveType,
  { icon: React.ReactNode; color: string; bgColor: string; borderColor: string; label: string }
> = {
  maximize: {
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    color: "text-green-700",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    label: "Maximize",
  },
  minimize: {
    icon: <TrendingDown className="h-3.5 w-3.5" />,
    color: "text-red-700",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    label: "Minimize",
  },
  maintain: {
    icon: <Shield className="h-3.5 w-3.5" />,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    label: "Maintain",
  },
  explore: {
    icon: <Search className="h-3.5 w-3.5" />,
    color: "text-purple-700",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    label: "Explore",
  },
  avoid: {
    icon: <AlertOctagon className="h-3.5 w-3.5" />,
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    label: "Avoid",
  },
};

const confidenceDot: Record<string, string> = {
  high: "bg-green-400",
  moderate: "bg-amber-400",
  low: "bg-red-400",
};

function ObjectiveCard({
  objective,
  onAccept,
  onDismiss,
}: {
  objective: SuggestedObjective;
  onAccept: (modified: SuggestedObjective) => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editedBaseline, setEditedBaseline] = useState(objective.baseline_estimate ?? 0);
  const [editedTarget, setEditedTarget] = useState(objective.target_estimate ?? 100);
  const config = objectiveConfig[objective.objective_type];

  return (
    <div
      className={cn(
        "rounded-lg border transition-all",
        config.borderColor,
        expanded ? "bg-white shadow-sm" : "bg-white/60 hover:bg-white hover:shadow-sm"
      )}
    >
      {/* Compact face */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
      >
        {/* Type badge */}
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md",
            config.bgColor,
            config.color
          )}
        >
          {config.icon}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("text-[9px] font-semibold uppercase tracking-wider", config.color)}>
              {config.label}
            </span>
            <span className={cn("h-1.5 w-1.5 rounded-full", confidenceDot[objective.confidence])} />
            {objective.external_evidence && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-purple-50 px-1.5 py-0.5 text-[8px] font-medium text-purple-600">
                <Globe className="h-2.5 w-2.5" />
                {objective.external_evidence.type}
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-gray-900 leading-snug mt-0.5">
            {objective.title}
          </p>
          {objective.metric_name && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              {objective.metric_name}
              {objective.target_estimate != null && (
                <span>
                  {" "}→ {objective.target_estimate}
                  {objective.metric_unit ? ` ${objective.metric_unit}` : ""}
                </span>
              )}
            </p>
          )}
        </div>

        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform mt-1",
            expanded && "rotate-90"
          )}
        />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2.5 space-y-2">
          <p className="text-[11px] text-gray-600 leading-relaxed">
            {objective.description}
          </p>

          <div className={cn("rounded-md px-2.5 py-2 text-[10px]", config.bgColor)}>
            <span className={cn("font-semibold", config.color)}>Why: </span>
            <span className="text-gray-600">{objective.rationale}</span>
          </div>

          {/* External evidence callout */}
          {objective.external_evidence && (
            <div className="rounded-md bg-purple-50 border border-purple-100 px-2.5 py-2 text-[10px]">
              <div className="flex items-center gap-1 mb-0.5">
                <Globe className="h-3 w-3 text-purple-500" />
                <span className="font-semibold text-purple-700">
                  {objective.external_evidence.type === "validates" && "Externally validated"}
                  {objective.external_evidence.type === "challenges" && "External challenge"}
                  {objective.external_evidence.type === "informs" && "Informed by external data"}
                  {objective.external_evidence.type === "precedent" && "External precedent"}
                </span>
              </div>
              <p className="text-purple-600">
                <span className="font-medium">{objective.external_evidence.source}</span>
                {" — "}
                {objective.external_evidence.detail}
              </p>
            </div>
          )}

          {(objective.baseline_estimate != null || objective.target_estimate != null) && (
            <div className="flex items-center gap-3 text-[10px] text-gray-500">
              {objective.baseline_estimate != null && (
                <span>
                  Baseline: <span className="font-medium text-gray-700">{objective.baseline_estimate}{objective.metric_unit ?? ""}</span>
                </span>
              )}
              {objective.target_estimate != null && (
                <span>
                  Target: <span className="font-medium text-gray-700">{objective.target_estimate}{objective.metric_unit ?? ""}</span>
                </span>
              )}
            </div>
          )}

          {/* Benchmark summary (compact) */}
          {objective.benchmark && (
            <div className="rounded-md border border-teal-100 bg-teal-50/50 px-2.5 py-2">
              <div className="flex items-center gap-1 mb-1">
                <BarChart3 className="h-3 w-3 text-teal-600" />
                <span className="text-[9px] font-semibold text-teal-700">Evaluation Criteria</span>
              </div>
              {objective.benchmark.evaluation_approach && (
                <p className="text-[10px] text-teal-600 italic mb-1.5">{objective.benchmark.evaluation_approach}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {objective.benchmark.success_criteria.filter(sc => sc.priority === "must_have").map((sc, i) => (
                  <span key={i} className="inline-flex items-center gap-0.5 rounded bg-white border border-teal-200 px-1.5 py-0.5 text-[9px] text-teal-700">
                    <Check className="h-2.5 w-2.5" />
                    {sc.threshold}
                  </span>
                ))}
                {objective.benchmark.leading_indicators.slice(0, 2).map((li, i) => (
                  <span key={i} className="inline-flex items-center gap-0.5 rounded bg-white border border-teal-200 px-1.5 py-0.5 text-[9px] text-gray-500">
                    <Activity className="h-2.5 w-2.5 text-teal-500" />
                    {li.metric}
                  </span>
                ))}
              </div>
              {objective.benchmark.milestones.length > 0 && (
                <div className="flex items-center gap-1 mt-1.5 text-[9px] text-gray-400">
                  {objective.benchmark.milestones.map((ms, i) => (
                    <span key={i}>
                      {i > 0 && " → "}
                      <span className="font-medium text-gray-500">{ms.name}</span>
                      <span className="text-teal-500"> ({ms.expected_by})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {confirming ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/40 p-2.5 space-y-2">
              <p className="text-[9px] text-amber-700">
                The AI estimated these values. Adjust them to match your actual situation.
              </p>
              {objective.metric_name && (
                <p className="text-[10px] text-gray-500">
                  Metric: <span className="font-medium text-gray-700">{objective.metric_name}</span>
                  {objective.metric_unit ? ` (${objective.metric_unit})` : ""}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-semibold text-gray-600 mb-0.5">
                    Where are you right now?
                  </label>
                  <input
                    type="number"
                    value={editedBaseline}
                    onChange={(e) => setEditedBaseline(Number(e.target.value))}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-mono text-gray-900 focus:border-interaxis-300 focus:outline-none focus:ring-1 focus:ring-interaxis-200"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-semibold text-gray-600 mb-0.5">
                    What&apos;s your target?
                  </label>
                  <input
                    type="number"
                    value={editedTarget}
                    onChange={(e) => setEditedTarget(Number(e.target.value))}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-mono text-gray-900 focus:border-interaxis-300 focus:outline-none focus:ring-1 focus:ring-interaxis-200"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAccept({
                      ...objective,
                      baseline_estimate: editedBaseline,
                      target_estimate: editedTarget,
                    });
                  }}
                  className="flex items-center gap-1 rounded-md bg-interaxis-600 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-interaxis-700 transition-colors"
                >
                  <Check className="h-3 w-3" />
                  Confirm & Create Goal
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirming(false);
                  }}
                  className="text-[10px] text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(true);
                }}
                className="flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-gray-800 transition-colors"
              >
                <Check className="h-3 w-3" />
                Track this objective
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
                className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-[10px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <X className="h-3 w-3" />
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Preliminary objective delta indicators ──

function matchPreliminaryToRefined(
  preliminary: PreliminaryObjective[],
  refined: SuggestedObjective[],
): Map<string, "confirmed" | "modified" | "replaced"> {
  const result = new Map<string, "confirmed" | "modified" | "replaced">();
  for (const pre of preliminary) {
    const titleLower = pre.title.toLowerCase();
    const match = refined.find(
      (r) =>
        r.title.toLowerCase() === titleLower ||
        r.title.toLowerCase().includes(titleLower.slice(0, 20)) ||
        titleLower.includes(r.title.toLowerCase().slice(0, 20)),
    );
    if (match) {
      result.set(
        match.key,
        match.title.toLowerCase() === titleLower ? "confirmed" : "modified",
      );
    }
  }
  // Refined objectives not matched to any preliminary = replaced
  for (const r of refined) {
    if (!result.has(r.key)) {
      result.set(r.key, "replaced");
    }
  }
  return result;
}

const deltaConfig = {
  confirmed: { icon: <Check className="h-2.5 w-2.5" />, label: "Confirmed", color: "text-green-600 bg-green-50" },
  modified: { icon: <Activity className="h-2.5 w-2.5" />, label: "Refined", color: "text-amber-600 bg-amber-50" },
  replaced: { icon: <Sparkles className="h-2.5 w-2.5" />, label: "New", color: "text-blue-600 bg-blue-50" },
};

export function SuggestedObjectivesModule({
  objectives,
  onAccept,
  onDismiss,
  preliminaryObjectives,
}: SuggestedObjectivesModuleProps) {
  if (!objectives.length && !preliminaryObjectives?.length) return null;

  const sorted = [...objectives].sort((a, b) => a.priority - b.priority);
  const externalCount = objectives.filter((o) => o.external_evidence).length;
  const deltaMap =
    preliminaryObjectives && preliminaryObjectives.length > 0 && objectives.length > 0
      ? matchPreliminaryToRefined(preliminaryObjectives, objectives)
      : null;

  return (
    <div className="space-y-2">
      {/* Preliminary objectives section (pre-synthesis) */}
      {preliminaryObjectives && preliminaryObjectives.length > 0 && objectives.length === 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <Target className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-[11px] font-semibold text-gray-500">
              Early detection
            </span>
            <span className="text-[10px] text-gray-400">
              — pre-synthesis objectives (will be refined)
            </span>
          </div>
          <div className="space-y-1">
            {preliminaryObjectives.map((po, i) => (
              <div
                key={i}
                className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-2.5 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-100">
                    {po.objective_type}
                  </span>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      po.confidence === "high" ? "bg-green-400" : po.confidence === "moderate" ? "bg-amber-400" : "bg-red-400"
                    )}
                  />
                </div>
                <p className="text-[11px] font-medium text-gray-600 mt-0.5">{po.title}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{po.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Refined objectives (post-synthesis) */}
      {objectives.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-1">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[11px] font-semibold text-gray-700">
              {deltaMap ? "Refined objectives" : "Detected objectives"}
            </span>
            <span className="text-[10px] text-gray-400">
              — {deltaMap ? "validated against full analysis" : "your analysis suggests these focus areas"}
            </span>
            {externalCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-purple-50 px-1.5 py-0.5 text-[9px] font-medium text-purple-500">
                <Globe className="h-2.5 w-2.5" />
                {externalCount} externally informed
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            {sorted.map((obj) => {
              const delta = deltaMap?.get(obj.key);
              const dc = delta ? deltaConfig[delta] : null;
              return (
                <div key={obj.key} className="relative">
                  {dc && (
                    <span
                      className={cn(
                        "absolute -top-1.5 right-2 z-10 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-semibold",
                        dc.color,
                      )}
                    >
                      {dc.icon}
                      {dc.label}
                    </span>
                  )}
                  <ObjectiveCard
                    objective={obj}
                    onAccept={(modified) => onAccept(modified)}
                    onDismiss={() => onDismiss(obj.key)}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
