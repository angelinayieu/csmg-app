"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Brain,
  Layers,
  GitBranch,
  MessageSquare,
  Eye,
  ChevronDown,
  Lightbulb,
} from "lucide-react";
import type {
  EpistemicClassification,
  PreliminaryObjective,
  CynefinDomain,
  InputType,
} from "@/types/epistemic";
import { DashboardCard } from "@/components/dashboard/dashboard-card";

interface EpistemicClassificationModuleProps {
  classification: EpistemicClassification;
}

// ── Input type display config ──

const INPUT_TYPE_CONFIG: Record<InputType, { label: string; color: string; bg: string }> = {
  research_paper: { label: "Research Paper", color: "text-blue-700", bg: "bg-blue-50" },
  business_problem: { label: "Business Problem", color: "text-emerald-700", bg: "bg-emerald-50" },
  technical_spec: { label: "Technical Spec", color: "text-slate-700", bg: "bg-slate-100" },
  question: { label: "Question", color: "text-purple-700", bg: "bg-purple-50" },
  argument: { label: "Argument", color: "text-orange-700", bg: "bg-orange-50" },
  narrative: { label: "Narrative", color: "text-pink-700", bg: "bg-pink-50" },
  data_analysis: { label: "Data Analysis", color: "text-cyan-700", bg: "bg-cyan-50" },
  strategic_plan: { label: "Strategic Plan", color: "text-indigo-700", bg: "bg-indigo-50" },
  creative_brief: { label: "Creative Brief", color: "text-rose-700", bg: "bg-rose-50" },
  hybrid: { label: "Hybrid", color: "text-gray-700", bg: "bg-gray-100" },
};

const CYNEFIN_CONFIG: Record<CynefinDomain, { label: string; color: string; border: string; bg: string }> = {
  simple: { label: "Simple", color: "text-green-700", border: "border-green-200", bg: "bg-green-50" },
  complicated: { label: "Complicated", color: "text-blue-700", border: "border-blue-200", bg: "bg-blue-50" },
  complex: { label: "Complex", color: "text-amber-700", border: "border-amber-200", bg: "bg-amber-50" },
  chaotic: { label: "Chaotic", color: "text-red-700", border: "border-red-200", bg: "bg-red-50" },
  disorder: { label: "Disorder", color: "text-gray-700", border: "border-gray-200", bg: "bg-gray-100" },
};

const PEARL_LABELS: Record<string, { label: string; rung: number }> = {
  association: { label: "Association", rung: 1 },
  intervention: { label: "Intervention", rung: 2 },
  counterfactual: { label: "Counterfactual", rung: 3 },
};

// ── Sub-components ──

function EpistemicDistributionBar({
  distribution,
}: {
  distribution: EpistemicClassification["evidence_distribution"];
}) {
  const segments = [
    { key: "observed", label: "Observed", pct: distribution.observed, color: "bg-green-500" },
    { key: "inferred", label: "Inferred", pct: distribution.inferred, color: "bg-blue-400" },
    { key: "theorized", label: "Theorized", pct: distribution.theorized, color: "bg-amber-400" },
    { key: "speculated", label: "Speculated", pct: distribution.speculated, color: "bg-red-400" },
  ].filter((s) => s.pct > 0);

  return (
    <div className="space-y-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={cn("h-full transition-all", seg.color)}
            style={{ width: `${Math.round(seg.pct * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {segments.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1 text-[9px] text-gray-500">
            <span className={cn("h-1.5 w-1.5 rounded-full", seg.color)} />
            {seg.label} {Math.round(seg.pct * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function PearlLadder({ depth }: { depth: string }) {
  const rungs = [
    { key: "association", label: "Association", description: "What correlates?" },
    { key: "intervention", label: "Intervention", description: "What happens if we act?" },
    { key: "counterfactual", label: "Counterfactual", description: "What if things were different?" },
  ];
  const activeRung = PEARL_LABELS[depth]?.rung ?? 1;

  return (
    <div className="flex items-center gap-1">
      {rungs.map((r, i) => {
        const isActive = i + 1 <= activeRung;
        const isCurrent = i + 1 === activeRung;
        return (
          <div
            key={r.key}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium transition-all",
              isCurrent
                ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200"
                : isActive
                ? "bg-indigo-50 text-indigo-500"
                : "bg-gray-50 text-gray-300"
            )}
            title={r.description}
          >
            {r.label}
          </div>
        );
      })}
    </div>
  );
}

function ToulminSummary({ toulmin }: { toulmin: EpistemicClassification["toulmin"] }) {
  if (!toulmin.has_argument) {
    return (
      <span className="text-[10px] text-gray-400 italic">No argument structure detected</span>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-700">
          {toulmin.claim_count} claim{toulmin.claim_count !== 1 ? "s" : ""}
        </span>
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[9px] font-medium",
            toulmin.evidence_quality === "strong"
              ? "bg-green-50 text-green-700"
              : toulmin.evidence_quality === "moderate"
              ? "bg-amber-50 text-amber-700"
              : "bg-red-50 text-red-700"
          )}
        >
          {toulmin.evidence_quality} evidence
        </span>
        {toulmin.warrant_explicit && (
          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
            Explicit warrants
          </span>
        )}
        {toulmin.rebuttal_present && (
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-600">
            Rebuttals present
          </span>
        )}
      </div>
      {toulmin.primary_claim && (
        <p className="text-[10px] text-gray-500 italic leading-relaxed">
          Primary claim: &ldquo;{toulmin.primary_claim}&rdquo;
        </p>
      )}
    </div>
  );
}

function PreliminaryObjectiveCard({ obj }: { obj: PreliminaryObjective }) {
  const typeColors: Record<string, string> = {
    maximize: "text-green-600 bg-green-50",
    minimize: "text-red-600 bg-red-50",
    maintain: "text-blue-600 bg-blue-50",
    explore: "text-purple-600 bg-purple-50",
    avoid: "text-amber-600 bg-amber-50",
    validate: "text-teal-600 bg-teal-50",
    build: "text-emerald-600 bg-emerald-50",
    defend: "text-orange-600 bg-orange-50",
  };
  const colorClass = typeColors[obj.objective_type] ?? "text-gray-600 bg-gray-50";

  return (
    <div className="rounded-lg border border-gray-100 bg-white/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className={cn("rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider", colorClass)}>
          {obj.objective_type}
        </span>
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            obj.confidence === "high" ? "bg-green-400" : obj.confidence === "moderate" ? "bg-amber-400" : "bg-red-400"
          )}
        />
      </div>
      <p className="text-[11px] font-medium text-gray-800 mt-1 leading-snug">{obj.title}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{obj.rationale}</p>
    </div>
  );
}

// ── Main Component ──

export function EpistemicClassificationModule({
  classification,
}: EpistemicClassificationModuleProps) {
  const [showDetails, setShowDetails] = useState(false);
  const typeConfig = INPUT_TYPE_CONFIG[classification.input_type];
  const cynefinConfig = CYNEFIN_CONFIG[classification.cynefin_domain];

  return (
    <DashboardCard
      title="Input Classification"
      subtitle="Epistemic routing analysis"
      icon={<Brain className="h-4 w-4" />}
      defaultExpanded={true}
      collapsible={true}
    >
      <div className="space-y-3">
        {/* Row 1: Input Type + Cynefin */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-xs font-semibold",
              typeConfig.bg,
              typeConfig.color
            )}
          >
            {typeConfig.label}
          </span>
          <span
            className={cn(
              "rounded-lg border px-2 py-1 text-[10px] font-medium",
              cynefinConfig.bg,
              cynefinConfig.color,
              cynefinConfig.border
            )}
          >
            {cynefinConfig.label}
          </span>
          <span className="text-[10px] text-gray-400">
            {Math.round(classification.input_type_confidence * 100)}% confidence
          </span>
        </div>

        {/* Row 2: Causal Depth (Pearl's Ladder) */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <GitBranch className="h-3 w-3 text-gray-400" />
            <span className="text-[10px] font-medium text-gray-500">Causal Depth</span>
          </div>
          <PearlLadder depth={classification.causal_depth} />
        </div>

        {/* Row 3: Epistemic Distribution */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Eye className="h-3 w-3 text-gray-400" />
            <span className="text-[10px] font-medium text-gray-500">Evidence Distribution</span>
          </div>
          <EpistemicDistributionBar distribution={classification.evidence_distribution} />
        </div>

        {/* Row 4: Marr's Levels */}
        {classification.marr_levels.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Layers className="h-3 w-3 text-gray-400" />
              <span className="text-[10px] font-medium text-gray-500">Analysis Levels (Marr)</span>
            </div>
            <div className="flex items-center gap-1">
              {(["computational", "algorithmic", "implementational"] as const).map((level) => {
                const active = classification.marr_levels.includes(level);
                return (
                  <span
                    key={level}
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[9px] font-medium",
                      active
                        ? "bg-teal-50 text-teal-700 ring-1 ring-teal-200"
                        : "bg-gray-50 text-gray-300"
                    )}
                  >
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 5: Toulmin Structure */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <MessageSquare className="h-3 w-3 text-gray-400" />
            <span className="text-[10px] font-medium text-gray-500">Argument Structure</span>
          </div>
          <ToulminSummary toulmin={classification.toulmin} />
        </div>

        {/* Expandable details */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", showDetails && "rotate-180")} />
          {showDetails ? "Hide" : "Show"} classification details
        </button>

        {showDetails && (
          <div className="space-y-2 border-t border-gray-100 pt-2">
            <div className="text-[10px] text-gray-500 space-y-1">
              <p><span className="font-medium text-gray-600">Cynefin rationale:</span> {classification.cynefin_rationale}</p>
              <p><span className="font-medium text-gray-600">Causal depth rationale:</span> {classification.causal_depth_rationale}</p>
              {classification.marr_rationale && (
                <p><span className="font-medium text-gray-600">Marr rationale:</span> {classification.marr_rationale}</p>
              )}
              {classification.input_type_signals.length > 0 && (
                <p>
                  <span className="font-medium text-gray-600">Signals:</span>{" "}
                  {classification.input_type_signals.join(", ")}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Preliminary Objectives */}
        {classification.preliminary_objectives.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Lightbulb className="h-3 w-3 text-amber-500" />
              <span className="text-[10px] font-medium text-gray-500">
                Early Detected Objectives
              </span>
              <span className="text-[9px] text-gray-400">(pre-synthesis)</span>
            </div>
            <div className="space-y-1.5">
              {classification.preliminary_objectives.map((obj, i) => (
                <PreliminaryObjectiveCard key={i} obj={obj} />
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
