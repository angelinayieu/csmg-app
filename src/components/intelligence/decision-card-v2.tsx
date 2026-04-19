"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Sparkles,
  Target,
  FlaskConical,
} from "lucide-react";
import type { PriorityDecisionV2, DecisionOption } from "@/types/intelligence-v2";

// ── Props ──

export interface DecisionCardV2Props {
  decision: PriorityDecisionV2;
  compact?: boolean;
  onCreateGoal?: (decision: PriorityDecisionV2) => void;
  /** Opens execution brief for the recommended next action */
  onExecute?: (decision: PriorityDecisionV2) => void;
  /** Accept the recommended option */
  onAccept?: (decision: PriorityDecisionV2) => void;
  /** Override with a different option */
  onOverride?: (decision: PriorityDecisionV2, optionId: string) => void;
  goalAlreadyCreated?: boolean;
  accepted?: boolean;
  className?: string;
}

// ── Config ──

const dueConfig: Record<string, { label: string; color: string; bg: string }> = {
  now: { label: "Within 48h", color: "text-red-700", bg: "bg-red-50" },
  this_week: { label: "This week", color: "text-amber-700", bg: "bg-amber-50" },
  this_month: { label: "This month", color: "text-blue-700", bg: "bg-blue-50" },
};

const evidenceConfig: Record<string, { label: string; color: string; bg: string }> = {
  stated: { label: "Stated", color: "text-green-700", bg: "bg-green-50" },
  inferred: { label: "Inferred", color: "text-amber-700", bg: "bg-amber-50" },
  predicted: { label: "Predicted", color: "text-purple-700", bg: "bg-purple-50" },
};

const effortColors: Record<string, string> = {
  low: "bg-green-50 text-green-700",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-red-50 text-red-700",
};

const reversibilityColors: Record<string, string> = {
  high: "bg-green-50 text-green-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-red-50 text-red-700",
};

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide", className)}>
      {children}
    </span>
  );
}

// ── Confidence Ring ──

function ConfidenceRing({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.7 ? "text-green-500" : value >= 0.4 ? "text-amber-500" : "text-red-500";
  const strokeColor = value >= 0.7 ? "#22c55e" : value >= 0.4 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 12;
  const dashOffset = circumference * (1 - value);

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg className="h-8 w-8 -rotate-90" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r="12" fill="none" stroke="#e5e7eb" strokeWidth="2" />
        <circle
          cx="14" cy="14" r="12" fill="none" stroke={strokeColor} strokeWidth="2.5"
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>
      <span className={cn("absolute text-[8px] font-bold", color)}>{pct}%</span>
    </div>
  );
}

// ── Option Row ──

function OptionRow({
  option,
  isRecommended,
}: {
  option: DecisionOption;
  isRecommended: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 transition-all",
        isRecommended
          ? "border-green-200 bg-green-50/40"
          : "border-gray-100 bg-gray-50/30"
      )}
    >
      <div className="flex items-center gap-2">
        {isRecommended && (
          <Sparkles className="h-3 w-3 text-green-500 flex-shrink-0" />
        )}
        <span className={cn("text-[11px] font-semibold", isRecommended ? "text-green-800" : "text-gray-800")}>
          {option.label}
        </span>
        {isRecommended && (
          <Badge className="bg-green-100 text-green-700">Recommended</Badge>
        )}
        {option.effort && (
          <Badge className={effortColors[option.effort]}>{option.effort} effort</Badge>
        )}
        {option.reversibility && (
          <Badge className={reversibilityColors[option.reversibility]}>
            {option.reversibility === "high" ? "Easy to reverse" : option.reversibility === "low" ? "Hard to reverse" : "Partially reversible"}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-[10px] leading-[1.5] text-gray-600">
        {option.description}
      </p>
      {(option.upside || option.downside) && (
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {option.upside && (
            <div className="flex items-start gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
              <span className="text-[9px] text-green-700 leading-snug">{option.upside}</span>
            </div>
          )}
          {option.downside && (
            <div className="flex items-start gap-1">
              <XCircle className="h-3 w-3 text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-[9px] text-red-600 leading-snug">{option.downside}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Card ──

export function DecisionCardV2({
  decision,
  compact = false,
  onCreateGoal,
  onExecute,
  onAccept,
  onOverride,
  goalAlreadyCreated = false,
  accepted = false,
  className,
}: DecisionCardV2Props) {
  const [expanded, setExpanded] = useState(!compact);
  const [overrideMode, setOverrideMode] = useState(false);

  const due = dueConfig[decision.due_window] ?? dueConfig.this_week;
  const evidence = evidenceConfig[decision.evidence_level] ?? evidenceConfig.inferred;

  // Compact mode: single line
  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={cn(
          "w-full flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-blue-200 transition-all group",
          className
        )}
      >
        <ConfidenceRing value={decision.confidence} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-gray-800 truncate">
            {decision.decision_question}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge className={cn(due.bg, due.color)}>
              <Clock className="h-2 w-2 mr-0.5" />
              {due.label}
            </Badge>
            <span className="text-[9px] text-gray-400">{decision.entity_name}</span>
          </div>
        </div>
        <ChevronRight className="h-3 w-3 text-gray-300 group-hover:text-blue-400 flex-shrink-0" />
      </button>
    );
  }

  return (
    <div className={cn("rounded-xl border border-gray-200 bg-white overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3 bg-gradient-to-r from-blue-50/30 to-white">
        <ConfidenceRing value={decision.confidence} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Badge className={cn(due.bg, due.color)}>
              <Clock className="h-2 w-2 mr-0.5" />
              {due.label}
            </Badge>
            <Badge className={cn(evidence.bg, evidence.color)}>
              {evidence.label}
            </Badge>
            {decision.core_tension_alignment > 0.5 && (
              <Badge className="bg-purple-50 text-purple-700">
                <AlertTriangle className="h-2 w-2 mr-0.5" />
                Core tension
              </Badge>
            )}
          </div>
          <h3 className="text-[13px] font-semibold text-gray-900 leading-snug">
            {decision.decision_question}
          </h3>
          <p className="mt-0.5 text-[10px] text-gray-500">
            {decision.entity_name}
          </p>
        </div>
        {compact && (
          <button
            onClick={() => setExpanded(false)}
            className="flex-shrink-0 text-gray-300 hover:text-gray-500"
          >
            <ChevronDown className="h-4 w-4 rotate-180" />
          </button>
        )}
      </div>

      {/* Options */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Target className="h-3 w-3 text-blue-500" />
          <span className="text-[9px] font-semibold uppercase tracking-[0.04em] text-blue-600">
            Options ({decision.options.length})
          </span>
        </div>
        {decision.options.map((opt) => (
          <OptionRow
            key={opt.id}
            option={opt}
            isRecommended={opt.id === decision.recommended_option_id}
          />
        ))}
      </div>

      {/* Recommendation reason */}
      {decision.recommended_reason && (
        <div className="mx-4 mb-3 rounded-lg border border-green-100 bg-green-50/40 px-3 py-2">
          <div className="flex items-start gap-1.5">
            <Sparkles className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
            <p className="text-[10px] leading-[1.5] text-green-800">
              {decision.recommended_reason}
            </p>
          </div>
        </div>
      )}

      {/* Tradeoffs */}
      {decision.tradeoffs.length > 0 && (
        <div className="mx-4 mb-3">
          <span className="text-[9px] font-semibold uppercase tracking-[0.04em] text-gray-500 mb-1 block">
            Key Tradeoffs
          </span>
          <div className="space-y-1">
            {decision.tradeoffs.map((t, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Shield className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
                <span className="text-[10px] text-gray-600 leading-snug">{t}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next action */}
      <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <ArrowRight className="h-3.5 w-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-[9px] font-semibold uppercase tracking-[0.04em] text-blue-600">
                Next Step
              </span>
              <p className="text-[11px] font-medium text-gray-800 mt-0.5">
                {decision.next_action}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onExecute && (
              <button
                onClick={() => onExecute(decision)}
                className="flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1.5 text-[10px] font-medium text-amber-700 hover:bg-amber-200 transition-all active:scale-[0.97]"
              >
                <FlaskConical className="h-3 w-3" />
                Execute
              </button>
            )}
            {onCreateGoal && !goalAlreadyCreated && (
              <button
                onClick={() => onCreateGoal(decision)}
                className="flex items-center gap-1 rounded-md bg-blue-100 px-2.5 py-1.5 text-[10px] font-medium text-blue-700 hover:bg-blue-200 transition-all active:scale-[0.97]"
              >
                <Target className="h-3 w-3" />
                Create Goal
              </button>
            )}
            {goalAlreadyCreated && (
              <Badge className="bg-green-50 text-green-600">
                <CheckCircle2 className="h-2 w-2 mr-0.5" />
                Goal created
              </Badge>
            )}
          </div>
        </div>

        {/* Accept / Override actions */}
        {(onAccept || onOverride) && !accepted && (
          <div className="mt-3 flex items-center gap-2">
            {onAccept && !overrideMode && (
              <button
                onClick={() => onAccept(decision)}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-green-700 transition-all shadow-sm active:scale-[0.98]"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Accept Recommendation
              </button>
            )}
            {onOverride && !overrideMode && (
              <button
                onClick={() => setOverrideMode(true)}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-all active:scale-[0.98]"
              >
                Override
              </button>
            )}
            {overrideMode && (
              <div className="flex-1 space-y-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Select an alternative:</p>
                {decision.options
                  .filter((opt) => opt.id !== decision.recommended_option_id)
                  .map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        onOverride?.(decision, opt.id);
                        setOverrideMode(false);
                      }}
                      className="w-full text-left rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50/50 transition-all"
                    >
                      {opt.label}
                    </button>
                  ))
                }
                <button
                  onClick={() => setOverrideMode(false)}
                  className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
        {accepted && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 border border-green-100 px-3 py-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            <span className="text-[11px] font-medium text-green-700">Decision accepted</span>
          </div>
        )}

        {/* Evidence refs */}
        {decision.evidence_refs.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[8px] text-gray-400">Evidence:</span>
            {decision.evidence_refs.map((ref, i) => (
              <span key={i} className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[8px] font-medium text-blue-600">
                {ref}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
