"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Target,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Sparkles,
  ArrowRight,
  History,
  Zap,
  Send,
  RotateCcw,
  Loader2,
  BarChart3,
  AlertTriangle,
  Milestone,
  Activity,
} from "lucide-react";
import type { SuggestedObjective, ObjectiveType, ObjectiveBenchmark } from "@/types/goals";
import { CalloutBox } from "@/components/ui/callout-box";

// ── Props ──

interface ObjectiveReviewFlowProps {
  objectives: SuggestedObjective[];
  spaceId: string;
  spaceName: string;
  onComplete: (approvedObjectives: SuggestedObjective[]) => void;
  onSkip: () => void;
}

// ── Config ──

const typeConfig: Record<
  ObjectiveType,
  { label: string; color: string; bg: string; border: string }
> = {
  maximize: { label: "MAX", color: "text-green-700", bg: "bg-green-50", border: "border-green-200" },
  minimize: { label: "MIN", color: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
  maintain: { label: "KEEP", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
  explore: { label: "EXPLORE", color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200" },
  avoid: { label: "AVOID", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
};

const depthConfig: Record<string, { label: string; color: string; bg: string; border: string }> = {
  fundamental: { label: "Fundamental", color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" },
  structural: { label: "Structural", color: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200" },
  surface: { label: "Surface", color: "text-gray-600", bg: "bg-gray-50", border: "border-gray-200" },
};

// ── Proposal set (for history) ──

interface ProposalSet {
  id: number;
  objectives: SuggestedObjective[];
  timestamp: number;
  source: "initial" | "reassessment";
}

// ── Benchmark Panel ──

const indicatorColors = {
  on_track: "text-emerald-600 bg-emerald-50",
  at_risk: "text-amber-600 bg-amber-50",
  off_track: "text-red-600 bg-red-50",
};

const priorityStyles = {
  must_have: "bg-red-50 text-red-700 border-red-200",
  should_have: "bg-amber-50 text-amber-700 border-amber-200",
  nice_to_have: "bg-gray-50 text-gray-600 border-gray-200",
};

const responseStyles = {
  investigate: "bg-blue-50 text-blue-700",
  adjust_target: "bg-amber-50 text-amber-700",
  pivot: "bg-orange-50 text-orange-700",
  abandon: "bg-red-50 text-red-700",
};

// ── Reticle Icon (matches objectives command center style) ──

function ReticleIcon({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden", className)}>
      {/* Animated sweep ring */}
      <div
        className="absolute inset-[-50%] animate-[sweep_4s_linear_infinite]"
        style={{
          background: "conic-gradient(from 0deg, rgba(99,102,241,0) 0deg, rgba(99,102,241,0.5) 60deg, rgba(99,102,241,0) 120deg)",
        }}
      />
      {/* Inner fill to mask the sweep center */}
      <div className="absolute inset-[2px] rounded-[inherit] bg-[linear-gradient(145deg,#0a1020_0%,#1e2a4a_55%,#3b5bdb_110%)] z-[1]" />
      {/* Crosshair SVG */}
      <svg
        viewBox="0 0 24 24"
        className="relative z-[2] w-[55%] h-[55%]"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 0 6px rgba(120,180,255,0.7))" }}
      >
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" fill="white" stroke="none" />
        <line x1="12" y1="1" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="23" />
        <line x1="1" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="23" y2="12" />
      </svg>
    </div>
  );
}

// ── Tree Branch Connector ──
// Renders a vertical spine + rounded bend into each child item

function TreeBranch({
  children,
  isLast = false,
}: {
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className="relative pl-5">
      {/* Vertical spine */}
      <div
        className={cn(
          "absolute left-[7px] top-0 w-px bg-teal-200",
          isLast ? "h-[14px]" : "h-full",
        )}
      />
      {/* Horizontal bend with rounded corner */}
      <svg
        className="absolute left-[3px] top-[6px] text-teal-200"
        width="16"
        height="14"
        viewBox="0 0 16 14"
        fill="none"
      >
        <path
          d="M4 0 L4 6 Q4 10 8 10 L16 10"
          stroke="currentColor"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      {/* Dot on the spine */}
      <div className="absolute left-[4px] top-[6px] h-[7px] w-[7px] rounded-full border-[1.5px] border-teal-300 bg-white z-[1]" />
      {/* Content */}
      <div className="pt-[2px] pb-1">
        {children}
      </div>
    </div>
  );
}

function BenchmarkPanel({ benchmark }: { benchmark: ObjectiveBenchmark }) {
  const [expanded, setExpanded] = useState(false);

  const totalSections =
    (benchmark.success_criteria.length > 0 ? 1 : 0) +
    (benchmark.leading_indicators.length > 0 ? 1 : 0) +
    (benchmark.milestones.length > 0 ? 1 : 0) +
    (benchmark.failure_signals.length > 0 ? 1 : 0);

  let sectionIndex = 0;

  return (
    <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50/40">
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
      >
        <BarChart3 className="h-3 w-3 text-teal-600" />
        <span className="text-[9px] font-semibold text-teal-700">
          Evaluation Criteria
        </span>
        <span className="text-[9px] text-teal-500 ml-auto">
          {benchmark.success_criteria.length} criteria · {benchmark.leading_indicators.length} indicators
        </span>
        <ChevronRight className={cn("h-3 w-3 text-teal-400 transition-transform duration-200", expanded && "rotate-90")} />
      </button>

      {expanded && (
        <div className="border-t border-teal-100 px-3 py-2">
          {/* Evaluation approach summary */}
          {benchmark.evaluation_approach && (
            <p className="text-[10px] text-teal-700 italic leading-relaxed mb-2">
              {benchmark.evaluation_approach}
            </p>
          )}

          {/* Tree-branching layout for benchmark sections */}
          <div className="relative">

            {/* Success Criteria */}
            {benchmark.success_criteria.length > 0 && (
              <TreeBranch isLast={++sectionIndex === totalSections}>
                <div className="flex items-center gap-1 mb-1.5">
                  <Check className="h-2.5 w-2.5 text-teal-600" />
                  <span className="text-[9px] font-semibold text-teal-700">Success Criteria</span>
                </div>
                <div className="space-y-1">
                  {benchmark.success_criteria.map((sc, i) => (
                    <div key={i} className="rounded-md border border-teal-100 bg-white/80 px-2 py-1.5">
                      <div className="flex items-start gap-1.5">
                        <span className={cn("mt-0.5 rounded border px-1 py-0 text-[8px] font-bold", priorityStyles[sc.priority])}>
                          {sc.priority === "must_have" ? "MUST" : sc.priority === "should_have" ? "SHOULD" : "NICE"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-gray-800 font-medium">{sc.criterion}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px] text-teal-600 font-mono">{sc.threshold}</span>
                            <span className="text-[8px] text-gray-400">via {sc.measurement}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </TreeBranch>
            )}

            {/* Leading Indicators */}
            {benchmark.leading_indicators.length > 0 && (
              <TreeBranch isLast={++sectionIndex === totalSections}>
                <div className="flex items-center gap-1 mb-1.5">
                  <Activity className="h-2.5 w-2.5 text-teal-600" />
                  <span className="text-[9px] font-semibold text-teal-700">Leading Indicators</span>
                </div>
                <div className="space-y-1">
                  {benchmark.leading_indicators.map((li, i) => (
                    <div key={i} className="rounded-md border border-teal-100 bg-white/80 px-2 py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-gray-800">{li.metric}</span>
                        <span className="text-[8px] text-gray-400">{li.check_frequency}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={cn("rounded px-1 py-0 text-[8px] font-medium", indicatorColors.on_track)}>✓ {li.on_track}</span>
                        <span className={cn("rounded px-1 py-0 text-[8px] font-medium", indicatorColors.at_risk)}>⚠ {li.at_risk}</span>
                        <span className={cn("rounded px-1 py-0 text-[8px] font-medium", indicatorColors.off_track)}>✗ {li.off_track}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </TreeBranch>
            )}

            {/* Milestones */}
            {benchmark.milestones.length > 0 && (
              <TreeBranch isLast={++sectionIndex === totalSections}>
                <div className="flex items-center gap-1 mb-1.5">
                  <Milestone className="h-2.5 w-2.5 text-teal-600" />
                  <span className="text-[9px] font-semibold text-teal-700">Milestones</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {benchmark.milestones.map((ms, i) => (
                    <div key={i} className="flex items-center gap-1">
                      {i > 0 && <ArrowRight className="h-2.5 w-2.5 text-gray-300" />}
                      <div className="rounded-md border border-teal-100 bg-white/80 px-2 py-1">
                        <p className="text-[9px] font-medium text-gray-700">{ms.name}</p>
                        <p className="text-[8px] text-teal-600">{ms.target_value} · {ms.expected_by}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </TreeBranch>
            )}

            {/* Failure Signals */}
            {benchmark.failure_signals.length > 0 && (
              <TreeBranch isLast={++sectionIndex === totalSections}>
                <div className="flex items-center gap-1 mb-1.5">
                  <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />
                  <span className="text-[9px] font-semibold text-amber-700">Failure Signals</span>
                </div>
                <div className="space-y-1">
                  {benchmark.failure_signals.map((fs, i) => (
                    <div key={i} className="flex items-start gap-1.5 rounded-md border border-amber-100 bg-amber-50/50 px-2 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-gray-700">{fs.signal}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={cn("rounded px-1 py-0 text-[8px] font-medium", responseStyles[fs.response])}>
                            {fs.response.replace("_", " ")}
                          </span>
                          <span className="text-[8px] text-gray-400">{fs.deadline}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </TreeBranch>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

// ── Objective Card ──

function ObjectiveCard({
  objective,
  included,
  onToggle,
  index,
}: {
  objective: SuggestedObjective;
  included: boolean;
  onToggle: () => void;
  index: number;
}) {
  const typeConf = typeConfig[objective.objective_type] ?? typeConfig.explore;
  const depth = objective.depth ? depthConfig[objective.depth] : null;

  return (
    <div
      className={cn(
        "rounded-xl border-2 p-4 transition-all duration-300",
        included
          ? "border-interaxis-300 bg-white shadow-sm"
          : "border-gray-200 bg-gray-50/50 opacity-60"
      )}
      style={{
        animation: `slideUp 400ms ease-out ${index * 80}ms both`,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Toggle */}
        <button
          onClick={onToggle}
          className={cn(
            "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-all duration-200",
            included
              ? "border-interaxis-500 bg-interaxis-500 text-white"
              : "border-gray-300 bg-white hover:border-gray-400"
          )}
        >
          {included && <Check className="h-3 w-3" />}
        </button>

        <div className="flex-1 min-w-0">
          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold", typeConf.bg, typeConf.color)}>
              {typeConf.label}
            </span>
            {depth && (
              <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-medium", depth.bg, depth.color, depth.border)}>
                {depth.label}
              </span>
            )}
            {objective.confidence && (
              <span className={cn(
                "rounded px-1.5 py-0.5 text-[9px]",
                objective.confidence === "high" ? "bg-emerald-50 text-emerald-600" :
                objective.confidence === "moderate" ? "bg-amber-50 text-amber-600" :
                "bg-gray-50 text-gray-500"
              )}>
                {objective.confidence}
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-gray-900 leading-snug">
            {objective.title}
          </h3>

          {/* Description */}
          <p className="mt-1 text-xs text-gray-600 leading-relaxed line-clamp-2">
            {objective.description}
          </p>

          {/* Metric */}
          {objective.metric_name && (
            <p className="mt-1.5 text-[10px] text-gray-400">
              <span className="font-medium text-gray-500">Metric:</span>{" "}
              {objective.metric_name}
              {objective.target_estimate ? ` (target: ${objective.target_estimate}${objective.metric_unit ? ` ${objective.metric_unit}` : ""})` : ""}
            </p>
          )}

          {/* Convergence */}
          {objective.convergence_score != null && objective.convergence_score > 0 && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[9px] text-gray-400">Convergence</span>
              <div className="flex gap-0.5">
                {Array.from({ length: Math.min(objective.convergence_score, 6) }).map((_, i) => (
                  <span key={i} className="h-1.5 w-1.5 rounded-full bg-interaxis-400" />
                ))}
              </div>
            </div>
          )}

          {/* Propellant */}
          {objective.propellant && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
              <div className="flex items-center gap-1">
                <Zap className="h-3 w-3 text-amber-600" />
                <span className="text-[9px] font-semibold text-amber-700">Key First Action</span>
              </div>
              <p className="mt-0.5 text-[10px] text-amber-800">{objective.propellant.action}</p>
              <p className="text-[9px] text-amber-600">{objective.propellant.why}</p>
            </div>
          )}

          {/* Benchmark & Evaluation Criteria */}
          {objective.benchmark && (
            <BenchmarkPanel benchmark={objective.benchmark} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Chat Message ──

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

// ── Baseline Confirmation Step ──

interface BaselineEdit {
  key: string;
  baseline: number;
  target: number;
}

const ABSTRACT_UNITS = new Set(["score", "level", "index", "rating"]);

function BaselineConfirmationPanel({
  objectives,
  onConfirm,
  onBack,
}: {
  objectives: SuggestedObjective[];
  onConfirm: (edited: SuggestedObjective[]) => void;
  onBack: () => void;
}) {
  const [edits, setEdits] = useState<BaselineEdit[]>(() =>
    objectives.map((obj) => {
      // Smart defaults based on metric unit — never blindly default to 0→100
      const unit = obj.metric_unit;
      const defaultTarget =
        unit === "%" ? 80
        : unit === "hours" || unit === "days" ? (obj.objective_type === "minimize" ? 1 : 30)
        : unit === "dollars" ? 1000
        : 10; // count, items, users, completions — 10 is more realistic than 100

      return {
        key: obj.key,
        baseline: obj.baseline_estimate ?? 0,
        target: obj.target_estimate ?? defaultTarget,
      };
    })
  );

  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});
  const toggleReasoning = (key: string) =>
    setExpandedReasoning((prev) => ({ ...prev, [key]: !prev[key] }));

  const updateEdit = (key: string, field: "baseline" | "target", value: number) => {
    setEdits((prev) =>
      prev.map((e) => (e.key === key ? { ...e, [field]: value } : e))
    );
  };

  const handleConfirm = () => {
    const editMap = new Map(edits.map((e) => [e.key, e]));
    const updated = objectives.map((obj) => {
      const edit = editMap.get(obj.key);
      if (!edit) return obj;
      return {
        ...obj,
        baseline_estimate: edit.baseline,
        target_estimate: edit.target,
      };
    });
    onConfirm(updated);
  };

  const hasEvidence = (obj: SuggestedObjective) =>
    !!(obj.baseline_evidence || obj.target_evidence || obj.rationale || obj.propellant);

  const showUnit = (unit: string | null) =>
    unit && !ABSTRACT_UNITS.has(unit);

  return (
    <div className="space-y-3" style={{ animation: "slideUp 300ms ease-out" }}>
      <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
        <p className="text-[10px] text-amber-700 font-medium">
          Review the AI&apos;s reasoning, then set realistic baselines and targets.
        </p>
        <p className="text-[9px] text-amber-600 mt-0.5">
          Use concrete numbers you can actually measure — counts, percentages, hours, etc. Expand &quot;Why these numbers?&quot; to see the AI&apos;s evidence.
        </p>
      </div>

      {objectives.map((obj) => {
        const edit = edits.find((e) => e.key === obj.key);
        if (!edit) return null;
        const typeConf = typeConfig[obj.objective_type] ?? typeConfig.explore;
        const depth = obj.depth ? depthConfig[obj.depth] : null;

        return (
          <div
            key={obj.key}
            className="rounded-xl border border-gray-200 bg-white p-4 space-y-3"
          >
            {/* Badges + title */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold", typeConf.bg, typeConf.color)}>
                {typeConf.label}
              </span>
              {depth && (
                <span className={cn("rounded border px-1 py-0.5 text-[8px] font-medium", depth.bg, depth.color, depth.border)}>
                  {depth.label}
                </span>
              )}
              {obj.confidence && (
                <span className={cn(
                  "rounded px-1 py-0.5 text-[8px]",
                  obj.confidence === "high" ? "bg-emerald-50 text-emerald-600" :
                  obj.confidence === "moderate" ? "bg-amber-50 text-amber-600" :
                  "bg-gray-50 text-gray-500"
                )}>
                  {obj.confidence}
                </span>
              )}
              <h3 className="text-sm font-semibold text-gray-900">{obj.title}</h3>
            </div>

            {/* Metric + description */}
            {obj.metric_name && (
              <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                <p className="text-[10px] text-gray-500">
                  Tracking: <span className="font-semibold text-gray-800">{obj.metric_name}</span>
                  {showUnit(obj.metric_unit) ? (
                    <span className="ml-1 rounded bg-indigo-50 text-indigo-600 px-1.5 py-0.5 text-[9px] font-medium">
                      {obj.metric_unit}
                    </span>
                  ) : null}
                </p>
                {obj.description && (
                  <p className="text-[9px] text-gray-400 mt-0.5 line-clamp-3">{obj.description}</p>
                )}
              </div>
            )}

            {/* Collapsible reasoning section */}
            {hasEvidence(obj) && (
              <button
                onClick={() => toggleReasoning(obj.key)}
                className="flex w-full items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-1.5 text-left hover:bg-gray-100 transition-colors"
              >
                <Sparkles className="h-3 w-3 text-interaxis-400" />
                <span className="text-[9px] font-semibold text-gray-500">
                  Why these numbers?
                </span>
                <ChevronRight className={cn(
                  "ml-auto h-3 w-3 text-gray-400 transition-transform duration-200",
                  expandedReasoning[obj.key] && "rotate-90"
                )} />
              </button>
            )}

            {expandedReasoning[obj.key] && (
              <div className="space-y-2 pl-1">
                {obj.baseline_evidence && (
                  <CalloutBox type="insight" label="Baseline evidence" compact>
                    {obj.baseline_evidence}
                  </CalloutBox>
                )}

                {obj.target_evidence && (
                  <CalloutBox type="action" label="Target rationale" compact>
                    {obj.target_evidence}
                  </CalloutBox>
                )}

                {/* Fallback to rationale when new evidence fields absent */}
                {obj.rationale && !obj.baseline_evidence && !obj.target_evidence && (
                  <CalloutBox type="chain" label="Reasoning" compact>
                    {obj.rationale}
                  </CalloutBox>
                )}

                {obj.propellant && (
                  <div className="flex items-start gap-1.5 rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-1.5">
                    <Zap className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-[9px] font-semibold text-amber-700">Key action: </span>
                      <span className="text-[10px] text-amber-800">{obj.propellant.action}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Baseline / target inputs */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-gray-600 mb-1">
                  Current {showUnit(obj.metric_unit) ? `(${obj.metric_unit})` : "value"}
                </label>
                <input
                  type="number"
                  value={edit.baseline}
                  onChange={(e) => updateEdit(obj.key, "baseline", Number(e.target.value))}
                  placeholder={obj.metric_unit === "%" ? "e.g. 12" : obj.metric_unit === "count" ? "e.g. 3" : "0"}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-mono text-gray-900 focus:border-interaxis-300 focus:outline-none focus:ring-1 focus:ring-interaxis-200"
                />
                <p className="text-[9px] text-gray-400 mt-0.5">
                  {obj.baseline_evidence ? "AI-estimated from your input — adjust if needed" : "Where you are right now"}
                </p>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-600 mb-1">
                  Target {showUnit(obj.metric_unit) ? `(${obj.metric_unit})` : "value"}
                </label>
                <input
                  type="number"
                  value={edit.target}
                  onChange={(e) => updateEdit(obj.key, "target", Number(e.target.value))}
                  placeholder={obj.metric_unit === "%" ? "e.g. 80" : obj.metric_unit === "count" ? "e.g. 25" : "10"}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-mono text-gray-900 focus:border-interaxis-300 focus:outline-none focus:ring-1 focus:ring-interaxis-200"
                />
                <p className="text-[9px] text-gray-400 mt-0.5">
                  {obj.target_evidence ? "AI-estimated 3-6 month target — adjust if needed" : "Where you want to be in 3-6 months"}
                </p>
              </div>
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <button
          onClick={handleConfirm}
          className="flex items-center gap-1.5 rounded-lg bg-interaxis-600 px-5 py-2 text-xs font-semibold text-white hover:bg-interaxis-700 transition-colors"
        >
          <Check className="h-3.5 w-3.5" />
          Confirm & Create {objectives.length} Goal{objectives.length !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ──

export function ObjectiveReviewFlow({
  objectives: initialObjectives,
  spaceId,
  spaceName,
  onComplete,
  onSkip,
}: ObjectiveReviewFlowProps) {
  // Proposal history
  const [proposalHistory, setProposalHistory] = useState<ProposalSet[]>([
    { id: 0, objectives: initialObjectives, timestamp: Date.now(), source: "initial" },
  ]);
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const currentSet = proposalHistory[currentSetIndex];

  // Baseline confirmation step
  const [showBaselineConfirm, setShowBaselineConfirm] = useState(false);

  // Include/exclude toggles (keyed by objective key)
  const [included, setIncluded] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const obj of initialObjectives) {
      // Default: include fundamental and structural, exclude surface
      map[obj.key] = obj.depth !== "surface";
    }
    return map;
  });

  // Discussion mode
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [reassessing, setReassessing] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Toggle include/exclude
  const toggleObjective = useCallback((key: string) => {
    setIncluded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Get included objectives from current set
  const getApprovedObjectives = useCallback(() => {
    return currentSet.objectives.filter((obj) => included[obj.key] !== false);
  }, [currentSet, included]);

  // Send chat message
  const sendMessage = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          messages: [
            ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: msg },
          ],
          operation: "question",
          context: `The user is reviewing detected objectives for their analysis "${spaceName}". Current objectives: ${currentSet.objectives.map((o) => `${o.title} (${o.objective_type})`).join(", ")}. Help them think about what might be missing, what should change, or what sub-objectives they haven't considered.`,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const reply = data.message ?? data.content ?? "I understand. Would you like me to reassess the objectives based on our discussion?";
        setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: "I had trouble processing that. Could you rephrase?" },
        ]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection error. Please try again." },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, chatMessages, currentSet, spaceId, spaceName]);

  // Reassess objectives (generates new proposal set)
  const reassessObjectives = useCallback(async () => {
    setReassessing(true);
    try {
      const res = await fetch(`/api/goals/reassess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          chatHistory: chatMessages.map((m) => `${m.role}: ${m.content}`).join("\n"),
          currentObjectives: currentSet.objectives,
          includedKeys: Object.entries(included)
            .filter(([, v]) => v)
            .map(([k]) => k),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const newObjectives = data.objectives ?? data.sub_objectives ?? [];
        if (newObjectives.length > 0) {
          const newSet: ProposalSet = {
            id: proposalHistory.length,
            objectives: newObjectives,
            timestamp: Date.now(),
            source: "reassessment",
          };
          setProposalHistory((prev) => [...prev, newSet]);
          setCurrentSetIndex(proposalHistory.length);
          // Reset included for new set
          const newIncluded: Record<string, boolean> = { ...included };
          for (const obj of newObjectives) {
            newIncluded[obj.key] = obj.depth !== "surface";
          }
          setIncluded(newIncluded);
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `I've reassessed and proposed ${newObjectives.length} updated objectives. Take a look at the new cards.` },
          ]);
        }
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to reassess. Please try again." },
      ]);
    } finally {
      setReassessing(false);
    }
  }, [spaceId, chatMessages, currentSet, included, proposalHistory]);

  // Navigate history
  const goToPrevious = useCallback(() => {
    if (currentSetIndex > 0) setCurrentSetIndex(currentSetIndex - 1);
  }, [currentSetIndex]);

  const goToNext = useCallback(() => {
    if (currentSetIndex < proposalHistory.length - 1)
      setCurrentSetIndex(currentSetIndex + 1);
  }, [currentSetIndex, proposalHistory.length]);

  const includedCount = currentSet.objectives.filter((o) => included[o.key] !== false).length;

  return (
    <>
      {/* Animation keyframes */}
      <style jsx global>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes sweep {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        style={{ animation: "fadeIn 300ms ease-out" }}
      >
        <div
          className={cn(
            "relative flex max-h-[90vh] w-full max-w-[900px] flex-col rounded-2xl bg-white shadow-2xl transition-all duration-300",
            discussionOpen && "max-w-[1200px]"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <ReticleIcon className="h-10 w-10 rounded-xl bg-[linear-gradient(145deg,#0a1020_0%,#1e2a4a_55%,#3b5bdb_110%)] shadow-[0_6px_16px_rgba(0,30,140,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]" />
              <div>
                <h1 className="text-base font-bold text-gray-900">
                  Objectives Detected
                </h1>
                <p className="text-xs text-gray-500">
                  Review what we identified from your analysis
                </p>
              </div>
            </div>
            {/* History nav */}
            {proposalHistory.length > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={goToPrevious}
                  disabled={currentSetIndex === 0}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-[10px] font-medium text-gray-400">
                  <History className="mr-1 inline h-3 w-3" />
                  {currentSetIndex + 1}/{proposalHistory.length}
                </span>
                <button
                  onClick={goToNext}
                  disabled={currentSetIndex === proposalHistory.length - 1}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {/* Body — split view when discussion open */}
          <div className="flex flex-1 overflow-hidden">
            {/* Cards column */}
            <div
              className={cn(
                "flex-1 overflow-y-auto px-6 py-4 transition-all duration-300",
                discussionOpen && "border-r border-gray-100"
              )}
            >
              {showBaselineConfirm ? (
                <BaselineConfirmationPanel
                  objectives={getApprovedObjectives()}
                  onConfirm={(editedObjectives) => {
                    setShowBaselineConfirm(false);
                    onComplete(editedObjectives);
                  }}
                  onBack={() => setShowBaselineConfirm(false)}
                />
              ) : (
                <>
                  <div className="space-y-3">
                    {currentSet.objectives.map((obj, i) => (
                      <ObjectiveCard
                        key={`${currentSet.id}-${obj.key}`}
                        objective={obj}
                        included={included[obj.key] !== false}
                        onToggle={() => toggleObjective(obj.key)}
                        index={i}
                      />
                    ))}
                  </div>

                  {currentSet.objectives.length === 0 && (
                    <div className="flex flex-col items-center py-12 text-center">
                      <Target className="h-8 w-8 text-gray-300 mb-2" />
                      <p className="text-sm text-gray-500">No objectives detected yet</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Discuss with AI to help identify your objectives
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Discussion panel */}
            {discussionOpen && (
              <div
                className="flex w-[380px] flex-shrink-0 flex-col bg-gray-50/50"
                style={{ animation: "slideInRight 300ms ease-out" }}
              >
                <div className="border-b border-gray-100 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-interaxis-500" />
                      <span className="text-xs font-semibold text-gray-700">Discuss Objectives</span>
                    </div>
                    <button
                      onClick={() => setDiscussionOpen(false)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">
                    Tell me what's missing, what should change, or what you want to add.
                  </p>
                </div>

                {/* Messages */}
                <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {chatMessages.length === 0 && (
                    <div className="rounded-lg bg-white border border-gray-200 p-3 text-xs text-gray-500">
                      <Sparkles className="h-3.5 w-3.5 text-interaxis-400 mb-1" />
                      I identified these objectives from your analysis. What do you think?
                      Are there goals you had in mind that I missed? Anything you'd want to adjust?
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-lg px-3 py-2 text-xs",
                        msg.role === "user"
                          ? "ml-8 bg-interaxis-600 text-white"
                          : "mr-8 bg-white border border-gray-200 text-gray-700"
                      )}
                    >
                      {msg.content}
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="mr-8 rounded-lg bg-white border border-gray-200 px-3 py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                    </div>
                  )}
                </div>

                {/* Input + reassess */}
                <div className="border-t border-gray-100 p-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                      placeholder="What's missing? What would you change?"
                      className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs placeholder:text-gray-400 focus:border-interaxis-300 focus:outline-none focus:ring-1 focus:ring-interaxis-200"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={chatLoading || !chatInput.trim()}
                      className="rounded-lg bg-interaxis-600 p-2 text-white hover:bg-interaxis-700 disabled:opacity-40 transition-colors"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={reassessObjectives}
                    disabled={reassessing || chatMessages.length === 0}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-interaxis-200 bg-interaxis-50 px-3 py-2 text-[10px] font-semibold text-interaxis-700 hover:bg-interaxis-100 disabled:opacity-40 transition-colors"
                  >
                    {reassessing ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Reassessing...</>
                    ) : (
                      <><RotateCcw className="h-3 w-3" /> Reassess objectives based on discussion</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer — hidden during baseline confirmation (it has its own buttons) */}
          {!showBaselineConfirm && (
            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
              <button
                onClick={onSkip}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Skip for now
              </button>

              <div className="flex items-center gap-3">
                {!discussionOpen && (
                  <button
                    onClick={() => setDiscussionOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Discuss with AI
                  </button>
                )}

                <button
                  onClick={() => setShowBaselineConfirm(true)}
                  disabled={includedCount === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-interaxis-600 px-5 py-2 text-xs font-semibold text-white hover:bg-interaxis-700 disabled:opacity-40 transition-colors"
                >
                  <Check className="h-3.5 w-3.5" />
                  Approve {includedCount} objective{includedCount !== 1 ? "s" : ""} & continue
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
