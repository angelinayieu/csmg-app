"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Sparkles,
  Brain,
  Search,
  Beaker,
  ShieldCheck,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Lightbulb,
  Network,
  TrendingUp,
} from "lucide-react";
import type {
  StrategyReasoningTrace,
  StrategicDiagnosis,
  StrategySynthesisResult,
  StrategyVerification,
  ProbabilitySpaceSummary,
} from "@/types/strategy-reasoning";

// ── Props ──

export interface ReasoningTracePanelProps {
  reasoningTrace: StrategyReasoningTrace;
  probabilitySpaceSummary?: ProbabilitySpaceSummary | null;
}

// ── Helpers ──

function formatTiming(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function ConfidenceBadge({ value, className }: { value: number; className?: string }) {
  const color = value >= 70 ? "bg-green-100 text-green-700 border-green-200" :
    value >= 40 ? "bg-amber-100 text-amber-700 border-amber-200" :
    "bg-red-100 text-red-700 border-red-200";
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[11px] font-bold", color, className)}>
      {value}%
    </span>
  );
}

// ── Step indicator ──

const STEPS = [
  { label: "Diagnosis", icon: <Search className="h-3 w-3" />, key: "diagnosis_ms" as const },
  { label: "Synthesis", icon: <Beaker className="h-3 w-3" />, key: "synthesis_ms" as const },
  { label: "Verification", icon: <ShieldCheck className="h-3 w-3" />, key: "verification_ms" as const },
];

function StepIndicator({ timings, activeStep }: { timings: StrategyReasoningTrace["step_timings"]; activeStep: number | null }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => (
        <React.Fragment key={step.label}>
          <div className={cn(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors",
            activeStep === i
              ? "bg-indigo-100 border border-indigo-300"
              : "bg-violet-50/60 border border-violet-200/60"
          )}>
            <span className={cn("text-violet-500", activeStep === i && "text-indigo-600")}>{step.icon}</span>
            <div className="flex flex-col">
              <span className={cn("text-[11px] font-semibold", activeStep === i ? "text-indigo-700" : "text-violet-700")}>
                {step.label}
              </span>
              <span className="text-[11px] text-violet-400 flex items-center gap-0.5">
                <Clock className="h-2 w-2" />
                {formatTiming(timings[step.key])}
              </span>
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <ArrowRight className="h-3 w-3 text-violet-300 flex-shrink-0" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Diagnosis Section ──

function DiagnosisSection({ diagnosis }: { diagnosis: StrategicDiagnosis }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50/60 to-white overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-violet-50/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-[12px] font-semibold text-violet-700">Diagnosis</span>
          <ConfidenceBadge value={diagnosis.confidence} />
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-violet-300 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t border-violet-100 px-3 py-3 space-y-3">
          {/* Core problem statement */}
          <div className="rounded-md border border-indigo-200 bg-indigo-50/40 px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-500">Core Problem</span>
            <p className="mt-0.5 text-[11px] font-medium text-gray-800 leading-relaxed">{diagnosis.core_problem_statement}</p>
          </div>

          {/* Graph insights */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Network className="h-3 w-3 text-violet-400" />
              <span className="text-[11px] font-semibold text-gray-500">Graph Insights</span>
            </div>

            {/* Hub entities */}
            {diagnosis.graph_insights.hub_entities.length > 0 && (
              <div className="mb-2">
                <span className="text-[11px] font-semibold text-gray-400 ml-4">Hub Entities</span>
                <div className="mt-1 space-y-1">
                  {diagnosis.graph_insights.hub_entities.map((hub, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-gray-100 bg-white px-2.5 py-1.5 ml-4">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-violet-100 text-[11px] font-bold text-violet-600 flex-shrink-0 mt-0.5">
                        H
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-gray-800">{hub.name}</span>
                          <span className="text-[11px] text-violet-500 font-medium">{hub.entity_id}</span>
                          <span className="text-[11px] text-gray-400">deg:{hub.degree} btw:{hub.betweenness.toFixed(2)}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">{hub.why_critical}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bottleneck edges */}
            {diagnosis.graph_insights.bottleneck_edges.length > 0 && (
              <div className="mb-2">
                <span className="text-[11px] font-semibold text-gray-400 ml-4">Bottleneck Edges</span>
                <div className="mt-1 space-y-0.5 ml-4">
                  {diagnosis.graph_insights.bottleneck_edges.map((edge, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-violet-500 font-medium">{edge.source}</span>
                      <ArrowRight className="h-2.5 w-2.5 text-gray-300" />
                      <span className="text-violet-500 font-medium">{edge.target}</span>
                      <span className="text-gray-400">-- {edge.constraint}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Critical cycles */}
            {diagnosis.graph_insights.critical_cycles.length > 0 && (
              <div className="mb-2">
                <span className="text-[11px] font-semibold text-gray-400 ml-4">Critical Cycles</span>
                <div className="mt-1 space-y-1 ml-4">
                  {diagnosis.graph_insights.critical_cycles.map((cycle, i) => (
                    <div key={i} className="rounded-md border border-gray-100 bg-white px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          "rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                          cycle.type === "reinforcing" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        )}>
                          {cycle.type}
                        </span>
                        <span className="text-[10px] font-medium text-gray-800">{cycle.name}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">Leverage: {cycle.leverage_point}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Probability insights */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp className="h-3 w-3 text-violet-400" />
              <span className="text-[11px] font-semibold text-gray-500">Probability Insights</span>
            </div>

            {/* High-risk failure points */}
            {diagnosis.probability_insights.high_risk_failure_points.length > 0 && (
              <div className="mb-2 ml-4">
                <span className="text-[11px] font-semibold text-gray-400">High-Risk Failure Points</span>
                <div className="mt-1 space-y-1">
                  {diagnosis.probability_insights.high_risk_failure_points.map((fp, i) => (
                    <div key={i} className="rounded-md border border-red-100 bg-red-50/30 px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="h-2.5 w-2.5 text-red-400" />
                        <span className="text-[10px] font-medium text-gray-800">{fp.edge_label}</span>
                        <span className="text-[11px] text-red-500 font-medium">P:{(fp.probability * 100).toFixed(0)}%</span>
                        <span className="text-[11px] text-gray-400">blast:{fp.blast_radius}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">{fp.failure_mode}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Intersection opportunities */}
            {diagnosis.probability_insights.intersection_opportunities.length > 0 && (
              <div className="mb-2 ml-4">
                <span className="text-[11px] font-semibold text-gray-400">Intersection Opportunities</span>
                <div className="mt-1 space-y-1">
                  {diagnosis.probability_insights.intersection_opportunities.map((opp, i) => (
                    <div key={i} className="rounded-md border border-green-100 bg-green-50/30 px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <Lightbulb className="h-2.5 w-2.5 text-green-500" />
                        <span className="text-[10px] font-medium text-gray-800">{opp.shared_variable}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">{opp.insight}</p>
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {opp.spaces_involved.map((s, si) => (
                          <span key={si} className="rounded bg-green-100 px-1 py-0.5 text-[11px] text-green-600">{s}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Signal synthesis */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles className="h-3 w-3 text-violet-400" />
              <span className="text-[11px] font-semibold text-gray-500">Signal Synthesis</span>
            </div>

            {/* Converging signals */}
            {diagnosis.signal_synthesis.converging_signals.length > 0 && (
              <div className="mb-2 ml-4">
                <span className="text-[11px] font-semibold text-gray-400">Converging Signals</span>
                <div className="mt-1 space-y-1">
                  {diagnosis.signal_synthesis.converging_signals.map((cs, i) => (
                    <div key={i} className="rounded-md border border-gray-100 bg-white px-2.5 py-1.5">
                      <div className="flex flex-wrap gap-0.5 mb-0.5">
                        {cs.signals.map((s, si) => (
                          <span key={si} className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-600 font-medium">{s}</span>
                        ))}
                      </div>
                      <p className="text-[11px] text-gray-600">Implication: {cs.implication}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Contradictory signals */}
            {diagnosis.signal_synthesis.contradictory_signals.length > 0 && (
              <div className="mb-2 ml-4">
                <span className="text-[11px] font-semibold text-gray-400">Contradictory Signals</span>
                <div className="mt-1 space-y-1">
                  {diagnosis.signal_synthesis.contradictory_signals.map((cs, i) => (
                    <div key={i} className="rounded-md border border-amber-100 bg-amber-50/30 px-2.5 py-1.5">
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-amber-600 font-medium">{cs.signal_a}</span>
                        <span className="text-gray-400">vs</span>
                        <span className="text-amber-600 font-medium">{cs.signal_b}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">Resolution: {cs.resolution}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blind spots */}
            {diagnosis.signal_synthesis.blind_spots.length > 0 && (
              <div className="ml-4">
                <span className="text-[11px] font-semibold text-gray-400">Blind Spots</span>
                <div className="mt-1 space-y-0.5">
                  {diagnosis.signal_synthesis.blind_spots.map((bs, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px]">
                      <AlertTriangle className="h-2.5 w-2.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-600">{bs}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Synthesis Section ──

function SynthesisSection({ synthesis }: { synthesis: StrategySynthesisResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50/60 to-white overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-violet-50/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Beaker className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-[12px] font-semibold text-violet-700">Synthesis</span>
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-600">
            {synthesis.options.length} options &middot; {synthesis.rejected_options.length} rejected
          </span>
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-violet-300 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t border-violet-100 px-3 py-3 space-y-3">
          {/* Options considered */}
          <div>
            <span className="text-[11px] font-semibold text-gray-500">Options Considered</span>
            <div className="mt-1.5 space-y-2">
              {synthesis.options.map((opt, i) => (
                <div key={i} className="rounded-lg border border-indigo-100 bg-white px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">{i + 1}</span>
                    <span className="text-xs font-semibold text-gray-800">{opt.title}</span>
                    <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-600">
                      {opt.strategic_posture}
                    </span>
                    <ConfidenceBadge value={opt.estimated_confidence} />
                  </div>
                  <p className="mt-1 text-[10px] text-gray-600 leading-relaxed">{opt.core_logic}</p>
                  <div className="mt-1.5 flex items-start gap-1 text-[11px]">
                    <span className="text-amber-500 font-semibold flex-shrink-0">Tradeoff:</span>
                    <span className="text-gray-500">{opt.key_tradeoff}</span>
                  </div>
                  {opt.leverages_intersection && (
                    <div className="mt-1 text-[11px] text-green-600 flex items-center gap-0.5">
                      <Lightbulb className="h-2.5 w-2.5" />
                      Leverages: {opt.leverages_intersection}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Rejected options */}
          {synthesis.rejected_options.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-gray-500">Rejected Options</span>
              <div className="mt-1.5 space-y-1">
                {synthesis.rejected_options.map((rej, i) => (
                  <div key={i} className="rounded-md border border-red-100 bg-red-50/20 px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <XCircle className="h-3 w-3 text-red-400" />
                      <span className="text-[10px] font-medium text-gray-700">{rej.title}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">{rej.rejection_reason}</p>
                    <p className="text-[11px] text-red-400 mt-0.5 italic">Failure mode: {rej.failure_mode_exposed}</p>
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

// ── Verification Section ──

function VerificationSection({ verification }: { verification: StrategyVerification }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50/60 to-white overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-violet-50/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-[12px] font-semibold text-violet-700">Verification</span>
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-600">
            {verification.verifications.length} verified
          </span>
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-violet-300 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t border-violet-100 px-3 py-3 space-y-3">
          {/* Per-option verifications */}
          {verification.verifications.map((v, i) => (
            <div key={i} className="rounded-lg border border-indigo-100 bg-white px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-800">{v.option_title}</span>
                <ConfidenceBadge value={v.verified_confidence} />
                {/* Delta from estimated, if synthesis data is available */}
              </div>

              {/* Failure mode exposure */}
              {v.failure_mode_exposure.length > 0 && (
                <div>
                  <span className="text-[11px] font-semibold text-gray-400">Failure Mode Exposure</span>
                  <div className="mt-0.5 space-y-0.5">
                    {v.failure_mode_exposure.map((fm, fi) => (
                      <div key={fi} className="text-[11px] rounded-md border border-red-50 bg-red-50/20 px-2 py-1">
                        <span className="text-red-500 font-medium">{fm.mode}</span>
                        <span className="text-gray-400"> -- mitigation: </span>
                        <span className="text-gray-600">{fm.mitigation}</span>
                        <span className="text-gray-400"> -- residual: </span>
                        <span className="text-amber-500">{fm.residual_risk}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Critical assumptions */}
              {v.critical_assumptions.length > 0 && (
                <div>
                  <span className="text-[11px] font-semibold text-gray-400">Critical Assumptions</span>
                  <div className="mt-0.5 space-y-0.5">
                    {v.critical_assumptions.map((ca, ci) => (
                      <div key={ci} className="flex items-start gap-1.5 text-[11px] rounded-md border border-gray-100 bg-gray-50/50 px-2 py-1">
                        <div className="flex-1 min-w-0">
                          <span className="text-gray-700">{ca.assumption}</span>
                          <span className="text-gray-400 ml-1">P:{(ca.probability * 100).toFixed(0)}%</span>
                        </div>
                        <span className="text-red-400 text-[11px] flex-shrink-0">If wrong: {ca.what_if_wrong}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Policy coherence */}
              <div className="flex items-center gap-1.5 text-[11px]">
                {v.policy_coherence.coherent ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    <span className="text-green-600 font-medium">Policy coherent</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    <span className="text-amber-600 font-medium">Policy issues:</span>
                    {v.policy_coherence.issues.map((issue, ii) => (
                      <span key={ii} className="text-gray-500">{issue}</span>
                    ))}
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Final ranking */}
          {verification.final_ranking.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-gray-500">Final Ranking</span>
              <div className="mt-1.5 space-y-1">
                {verification.final_ranking.map((fr, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50/20 px-2.5 py-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                      #{fr.rank}
                    </span>
                    <span className="text-[10px] font-semibold text-gray-800">{fr.title}</span>
                    <span className="text-[11px] text-gray-400 ml-auto">{fr.adjustment_reason}</span>
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

// ── Main Component ──

export function ReasoningTracePanel({
  reasoningTrace,
  probabilitySpaceSummary,
}: ReasoningTracePanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-indigo-50/40 via-violet-50/30 to-white overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-violet-50/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-500" />
          <span className="text-xs font-bold text-violet-700 uppercase tracking-wider">Reasoning Trace</span>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-600 flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatTiming(reasoningTrace.total_duration_ms)} total
          </span>
          <Sparkles className="h-3 w-3 text-violet-400" />
        </div>
        <ChevronDown className={cn("h-4 w-4 text-violet-300 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t border-violet-100 px-4 py-4 space-y-4">
          {/* Step indicator */}
          <StepIndicator timings={reasoningTrace.step_timings} activeStep={null} />

          {/* Sections */}
          <DiagnosisSection diagnosis={reasoningTrace.diagnosis} />
          <SynthesisSection synthesis={reasoningTrace.synthesis} />
          <VerificationSection verification={reasoningTrace.verification} />

          {/* Probability space summary */}
          {probabilitySpaceSummary && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className="h-3 w-3 text-violet-500" />
                <span className="text-[10px] font-semibold text-violet-700 uppercase tracking-wider">Probability Space Summary</span>
              </div>
              <div className="flex items-center gap-4 text-[10px]">
                <div className="text-center">
                  <div className="text-lg font-bold text-violet-700">{probabilitySpaceSummary.spaces_analyzed}</div>
                  <div className="text-[11px] text-gray-400">spaces analyzed</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-indigo-600">{probabilitySpaceSummary.intersections_found}</div>
                  <div className="text-[11px] text-gray-400">intersections</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-500">{probabilitySpaceSummary.high_risk_points}</div>
                  <div className="text-[11px] text-gray-400">high-risk points</div>
                </div>
              </div>
              {probabilitySpaceSummary.key_insights.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {probabilitySpaceSummary.key_insights.map((insight, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px]">
                      <Lightbulb className="h-2.5 w-2.5 text-violet-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-600">{insight}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
