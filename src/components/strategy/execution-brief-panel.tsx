"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  FlaskConical,
  Brain,
  ListOrdered,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Loader2,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Lightbulb,
  Target,
  Zap,
} from "lucide-react";
import { useTestLab } from "@/lib/hooks/use-test-lab";
import { TestLabPanel } from "@/components/strategy/test-lab-panel";
import type {
  ExecutionBrief,
  EvidenceSource,
  AlternativeApproach,
  ContextDetection,
  ContextType,
  ExecutionStep,
} from "@/types/execution-brief";

// ── Props ──

export interface TestLabParams {
  spaceId: string;
  recommendationId: string;
  recommendationTitle: string;
  recommendationText: string;
  relatedEntityIds?: string[];
}

export interface ExecutionBriefPanelProps {
  brief: ExecutionBrief | null;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
  testLabParams?: TestLabParams;
  className?: string;
}

// ── Helpers ──

const confidenceConfig: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  high: { label: "High", bg: "bg-green-50", text: "text-green-700" },
  moderate: { label: "Moderate", bg: "bg-amber-50", text: "text-amber-700" },
  low: { label: "Low", bg: "bg-red-50", text: "text-red-600" },
};

const effortConfig: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  low: { label: "Low effort", bg: "bg-green-50", text: "text-green-700" },
  medium: { label: "Med effort", bg: "bg-amber-50", text: "text-amber-700" },
  high: { label: "High effort", bg: "bg-red-50", text: "text-red-600" },
};

const impactConfig: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  high: { label: "High impact", bg: "bg-green-50", text: "text-green-700" },
  medium: { label: "Med impact", bg: "bg-amber-50", text: "text-amber-700" },
  low: { label: "Low impact", bg: "bg-red-50", text: "text-red-600" },
};

const strengthConfig: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  strong: { label: "Strong", bg: "bg-green-50", text: "text-green-700" },
  moderate: { label: "Moderate", bg: "bg-amber-50", text: "text-amber-700" },
  weak: { label: "Weak", bg: "bg-gray-100", text: "text-gray-500" },
};

const contextTypeConfig: Record<
  ContextType,
  { label: string; bg: string; text: string }
> = {
  prompt: { label: "Prompt", bg: "bg-blue-50", text: "text-blue-700" },
  entity: { label: "Entity", bg: "bg-indigo-50", text: "text-indigo-700" },
  strategy: { label: "Strategy", bg: "bg-purple-50", text: "text-purple-700" },
  research: { label: "Research", bg: "bg-teal-50", text: "text-teal-700" },
  process: { label: "Process", bg: "bg-amber-50", text: "text-amber-700" },
};

function evidenceIcon(type: EvidenceSource["type"]) {
  switch (type) {
    case "entity":
      return <Target className="h-3 w-3 text-blue-500" />;
    case "edge":
      return <ArrowRight className="h-3 w-3 text-green-500" />;
    case "cycle":
      return <Loader2 className="h-3 w-3 text-amber-500" />;
    case "external":
      return <BookOpen className="h-3 w-3 text-purple-500" />;
    case "research":
      return <FlaskConical className="h-3 w-3 text-teal-500" />;
    case "intersection":
      return <Zap className="h-3 w-3 text-indigo-500" />;
    default:
      return <BookOpen className="h-3 w-3 text-gray-400" />;
  }
}

function Badge({
  config,
}: {
  config: { label: string; bg: string; text: string };
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide",
        config.bg,
        config.text
      )}
    >
      {config.label}
    </span>
  );
}

// ── Section Header ──

function SectionHead({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      {icon}
      <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500">
        {title}
      </span>
    </div>
  );
}

// ── Skeleton Shimmer ──

function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-gray-100",
        className
      )}
    />
  );
}

function SkeletonSection() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Shimmer className="h-3.5 w-3.5 rounded" />
        <Shimmer className="h-2.5 w-20" />
      </div>
      <Shimmer className="h-3 w-full" />
      <Shimmer className="h-3 w-4/5" />
      <div className="flex gap-2 mt-2">
        <Shimmer className="h-12 w-1/3 rounded-lg" />
        <Shimmer className="h-12 w-1/3 rounded-lg" />
        <Shimmer className="h-12 w-1/3 rounded-lg" />
      </div>
    </div>
  );
}

// ── Section 1: Research Backing ──

function ResearchBackingSection({
  backing,
}: {
  backing: ExecutionBrief["research_backing"];
}) {
  const conf = confidenceConfig[backing.confidence] ?? confidenceConfig.moderate;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <SectionHead
          icon={<BookOpen className="h-3.5 w-3.5 text-blue-500" />}
          title="Research Backing"
        />
        <Badge config={conf} />
      </div>

      {/* Causal chain */}
      <p className="text-[11px] leading-[1.5] text-gray-600">
        {backing.causal_chain}
      </p>

      {/* Evidence sources */}
      {backing.evidence_sources.length > 0 && (
        <div className="space-y-1">
          {backing.evidence_sources.map((src, i) => {
            const str =
              strengthConfig[src.strength] ?? strengthConfig.moderate;
            return (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-2.5 py-2"
              >
                <span className="mt-0.5 flex-shrink-0">
                  {evidenceIcon(src.type)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-gray-800 truncate">
                      {src.reference_name}
                    </span>
                    <Badge config={str} />
                  </div>
                  <p className="text-[10px] text-gray-500 leading-snug line-clamp-1 mt-0.5">
                    {src.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Section 2: Alternative Approaches ──

function AlternativeApproachesSection({
  approaches,
}: {
  approaches: AlternativeApproach[];
}) {
  if (approaches.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <SectionHead
        icon={<Lightbulb className="h-3.5 w-3.5 text-amber-500" />}
        title="Alternative Approaches"
      />
      <div className="grid gap-2">
        {approaches.map((approach, i) => {
          const eff = effortConfig[approach.effort] ?? effortConfig.medium;
          const imp = impactConfig[approach.impact] ?? impactConfig.medium;
          const conf =
            confidenceConfig[approach.confidence] ??
            confidenceConfig.moderate;

          return (
            <div
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-2.5 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-semibold text-gray-800">
                  {approach.title}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Badge config={eff} />
                  <Badge config={imp} />
                  <Badge config={conf} />
                </div>
              </div>
              <p className="text-[10px] leading-[1.5] text-gray-500">
                {approach.description}
              </p>
              {approach.tradeoffs.length > 0 && (
                <div className="space-y-0.5 pt-1 border-t border-gray-50">
                  {approach.tradeoffs.map((t, j) => (
                    <div key={j} className="flex items-start gap-3">
                      <div className="flex items-start gap-1 flex-1 min-w-0">
                        <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="text-[10px] text-gray-600 leading-snug">
                          {t.pro}
                        </span>
                      </div>
                      <div className="flex items-start gap-1 flex-1 min-w-0">
                        <XCircle className="h-3 w-3 text-red-400 mt-0.5 flex-shrink-0" />
                        <span className="text-[10px] text-gray-500 leading-snug">
                          {t.con}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 3: Context-Aware Proposal ──

function ContextDetectionSection({
  context,
}: {
  context: ContextDetection;
}) {
  const ctxConf =
    contextTypeConfig[context.context_type] ?? contextTypeConfig.entity;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <SectionHead
          icon={<Brain className="h-3.5 w-3.5 text-purple-500" />}
          title="System Context Detected"
        />
        <Badge config={ctxConf} />
      </div>

      {/* Current state */}
      <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-600">
          Current State
        </span>
        <p className="text-[10px] leading-[1.5] text-gray-700 mt-1">
          {context.current_state}
        </p>
      </div>

      {/* Proposed changes */}
      <div className="rounded-lg border border-green-100 bg-green-50/40 px-3 py-2">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-green-600">
          Proposed Changes
        </span>
        <p className="text-[10px] leading-[1.5] text-gray-700 mt-1">
          {context.proposed_changes}
        </p>
      </div>

      {/* Before/After comparison */}
      {context.before_after && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-red-100 bg-red-50/30 px-2.5 py-2">
            <span className="text-[8px] font-semibold uppercase tracking-wide text-red-500">
              Before
            </span>
            <p className="text-[10px] leading-[1.5] text-gray-600 mt-1">
              {context.before_after.before}
            </p>
          </div>
          <div className="rounded-lg border border-green-100 bg-green-50/30 px-2.5 py-2">
            <span className="text-[8px] font-semibold uppercase tracking-wide text-green-600">
              After
            </span>
            <p className="text-[10px] leading-[1.5] text-gray-600 mt-1">
              {context.before_after.after}
            </p>
          </div>
        </div>
      )}

      {/* Related entities */}
      {context.related_entity_ids.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {context.related_entity_ids.map((id) => (
            <span
              key={id}
              className="inline-flex items-center rounded-full bg-purple-50 px-1.5 py-0.5 text-[9px] font-medium text-purple-600"
            >
              {id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section 4: Execution Steps ──

function ExecutionStepsSection({ steps }: { steps: ExecutionStep[] }) {
  if (steps.length === 0) return null;

  const sorted = [...steps].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-2.5">
      <SectionHead
        icon={<ListOrdered className="h-3.5 w-3.5 text-indigo-500" />}
        title="Execution Plan"
      />
      <div className="space-y-1.5">
        {sorted.map((step) => (
          <div
            key={step.order}
            className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-white px-2.5 py-2"
          >
            {/* Step number circle */}
            <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-bold text-indigo-700 flex-shrink-0">
              {step.order}
            </span>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-gray-800">
                  {step.action}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide bg-gray-100 text-gray-600"
                  )}
                >
                  {step.estimated_effort}
                </span>
              </div>
              <p className="text-[10px] leading-[1.5] text-gray-500">
                {step.detail}
              </p>
              {/* Dependencies */}
              {step.depends_on.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[9px] text-gray-400">Requires:</span>
                  {step.depends_on.map((dep) => (
                    <span
                      key={dep}
                      className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[8px] font-medium text-indigo-600"
                    >
                      <ChevronRight className="h-2 w-2" />
                      Step {dep}
                    </span>
                  ))}
                </div>
              )}
              {/* Infrastructure note */}
              {step.infrastructure_note && (
                <div className="rounded border-l-2 border-amber-300 bg-amber-50/50 px-2 py-1.5 mt-1">
                  <div className="flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
                    <span className="text-[9px] text-amber-700 leading-snug">
                      {step.infrastructure_note}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Auto-detect test type from context detection ──

function inferTestType(
  brief: ExecutionBrief
): "prompt_comparison" | "strategy_comparison" | "scenario_simulation" {
  const ct = brief.context_detection?.context_type;
  if (ct === "prompt") return "prompt_comparison";
  if (ct === "strategy") return "strategy_comparison";
  return "scenario_simulation";
}

// ── Main Panel ──

export function ExecutionBriefPanel({
  brief,
  loading,
  error,
  onGenerate,
  testLabParams,
  className,
}: ExecutionBriefPanelProps) {
  const [testLabOpen, setTestLabOpen] = useState(false);

  // Test lab hook — always called (hooks can't be conditional)
  const testLabHook = useTestLab({
    spaceId: testLabParams?.spaceId ?? "",
    recommendationId: testLabParams?.recommendationId ?? "",
  });

  // ── Loading state ──
  if (loading) {
    return (
      <div className={cn("space-y-4 rounded-xl border border-gray-200 bg-gray-50/30 p-4", className)}>
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin" />
          <span className="text-[11px] font-medium text-gray-500">
            Generating execution brief...
          </span>
        </div>
        <SkeletonSection />
        <SkeletonSection />
        <SkeletonSection />
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div
        className={cn(
          "rounded-xl border border-red-200 bg-red-50/50 p-3",
          className
        )}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-red-700">
              Failed to generate brief
            </p>
            <p className="text-[10px] text-red-500 mt-0.5">{error}</p>
          </div>
          <button
            onClick={onGenerate}
            className="flex-shrink-0 rounded-md bg-red-100 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-200 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Empty / not-loaded state ──
  if (!brief) {
    return (
      <div className={cn("rounded-xl border border-dashed border-gray-200 bg-gray-50/30 p-4", className)}>
        <div className="flex flex-col items-center gap-2 py-2">
          <FlaskConical className="h-4 w-4 text-gray-300" />
          <p className="text-[11px] text-gray-400">
            Expand to see execution brief
          </p>
          <button
            onClick={onGenerate}
            className="flex items-center gap-1 rounded-md bg-indigo-50 px-3 py-1.5 text-[10px] font-medium text-indigo-600 hover:bg-indigo-100 transition-colors"
          >
            <Zap className="h-3 w-3" />
            Generate Brief
          </button>
        </div>
      </div>
    );
  }

  // Determine if test lab should be available
  const canTestLab = !!testLabParams?.spaceId && !!testLabParams?.recommendationId;
  const detectedTestType = inferTestType(brief);

  const handleTestLabToggle = () => {
    const opening = !testLabOpen;
    setTestLabOpen(opening);

    // Auto-generate when opening for the first time if no result cached
    if (opening && !testLabHook.testLab && !testLabHook.loading && canTestLab) {
      testLabHook.generate({
        testType: detectedTestType,
        recommendationTitle: testLabParams!.recommendationTitle,
        recommendationText: testLabParams!.recommendationText,
        relatedEntityIds: testLabParams!.relatedEntityIds,
      });
    }
  };

  const handleTestLabGenerate = () => {
    if (!canTestLab) return;
    testLabHook.generate({
      testType: detectedTestType,
      recommendationTitle: testLabParams!.recommendationTitle,
      recommendationText: testLabParams!.recommendationText,
      relatedEntityIds: testLabParams!.relatedEntityIds,
    });
  };

  // ── Loaded state ──
  return (
    <div
      className={cn(
        "space-y-4 rounded-xl border border-gray-200 bg-white p-4",
        className
      )}
    >
      {/* Section 1: Research Backing */}
      <ResearchBackingSection backing={brief.research_backing} />

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* Section 2: Alternative Approaches */}
      <AlternativeApproachesSection approaches={brief.alternative_approaches} />

      {/* Section 3: Context Detection (conditional) */}
      {brief.context_detection && (
        <>
          <div className="border-t border-gray-100" />
          <ContextDetectionSection context={brief.context_detection} />
        </>
      )}

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* Section 4: Execution Steps */}
      <ExecutionStepsSection steps={brief.execution_steps} />

      {/* Section 5: Test Lab (collapsible, opt-in) */}
      {canTestLab && (
        <>
          <div className="border-t border-gray-100" />
          <div>
            <button
              onClick={handleTestLabToggle}
              className="w-full flex items-center justify-between group"
            >
              <div className="flex items-center gap-1.5">
                <FlaskConical className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-purple-600 group-hover:text-purple-700">
                  Test Lab
                </span>
                <span className="text-[9px] text-gray-400">
                  Compare variant approaches
                </span>
              </div>
              <ChevronDown
                className={cn(
                  "h-3 w-3 text-purple-300 transition-transform",
                  testLabOpen && "rotate-180"
                )}
              />
            </button>
            {testLabOpen && (
              <div className="mt-3">
                <TestLabPanel
                  testLab={brief.test_lab ?? testLabHook.testLab}
                  loading={testLabHook.loading}
                  error={testLabHook.error}
                  savingPreference={testLabHook.savingPreference}
                  onGenerate={handleTestLabGenerate}
                  onSetPreferred={testLabHook.setPreferred}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
