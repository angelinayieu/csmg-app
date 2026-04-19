"use client";

import { TIERS, type AnalysisTier } from "@/lib/tiers";
import type { AnalysisConfig } from "@/lib/hooks/use-pipeline";
import type { UserRole, PrimaryGoal, ContextType } from "@/types/analysis";
import {
  ROLE_OPTIONS,
  GOAL_OPTIONS,
  CONTEXT_OPTIONS,
} from "@/lib/prompts/intent-context";
import { cn } from "@/lib/utils";

// ── Human-readable lens descriptions ──

const ROLE_LENS: Record<string, string> = {
  solo_founder:
    "solo founder lens — prioritizing actionable decisions, resource constraints, and execution speed",
  founding_team:
    "founding team lens — prioritizing alignment, coordination risks, and parallel execution",
  investor:
    "investor lens — prioritizing market dynamics, competitive moats, and risk/return",
  advisor:
    "advisor lens — prioritizing strategic leverage, second-order effects, and coaching clarity",
  researcher:
    "researcher lens — prioritizing evidence quality, methodology, and knowledge gaps",
  student:
    "student lens — prioritizing clear explanations, foundational concepts, and incremental learning",
  operator:
    "operator lens — prioritizing process efficiency, operational metrics, and failure modes",
  executive:
    "executive lens — prioritizing strategic positioning, resource allocation, and competitive dynamics",
};

const GOAL_DESCRIPTION: Record<string, string> = {
  make_decision: "making a key decision",
  understand_system: "deep understanding of the system",
  build_plan: "building an action plan",
  evaluate_risk: "evaluating risks and vulnerabilities",
  explore_options: "exploring the option space",
  validate_assumptions: "validating key assumptions",
};

const CONTEXT_DESCRIPTION: Record<string, string> = {
  startup: "startup / new venture",
  research: "research / academic investigation",
  career: "career / professional development",
  strategy: "strategic planning",
  operations: "operations / execution",
  investment: "investment / evaluation",
  education: "education / learning",
};

// ── Time estimates per tier ──

const TIME_ESTIMATES: Record<string, string> = {
  quick: "~10s",
  standard: "~25s",
  deep: "~45s",
  comprehensive: "~90s",
};

// ── Pipeline step definitions ──

interface PipelineStep {
  label: string;
  enabled: boolean;
  detail?: string;
}

function getPipelineSteps(config: AnalysisConfig, tier: AnalysisTier): PipelineStep[] {
  const spaceCount = config.selectedSpaces.length;
  const hasExternal = config.crossSpace.externalKnowledge;
  const hasWeave = config.crossSpace.weave && spaceCount >= 2;
  const hasSynthesis = config.crossSpace.synthesis;
  const isComprehensive = tier === "comprehensive";
  const researchDepth = config.crossSpace.researchDepth ?? "training";

  return [
    {
      label: "Decompose situation into knowledge graph",
      enabled: true,
    },
    {
      label: "Structural critique & augmentation",
      enabled: tier !== "quick",
    },
    {
      label: `Domain expert research — ${researchDepth} depth`,
      enabled: hasExternal,
    },
    {
      label: "Bridge discovery — connect external findings",
      enabled: hasExternal,
    },
    {
      label: "Cross-space weaving",
      enabled: hasWeave,
    },
    {
      label: "Synthesis with quality evaluation",
      enabled: hasSynthesis,
    },
    {
      label: "Strategy generation",
      enabled: isComprehensive,
    },
    {
      label: "Reasoning passes: centrality, cycles, cascade, link prediction",
      enabled: isComprehensive,
    },
  ];
}

// ── Props ──

export interface AnalysisSpecPreviewProps {
  config: AnalysisConfig;
  tier: AnalysisTier;
  scopeResult?: {
    spaces: Array<{
      name: string;
      prefix: string;
      description: string;
      key_concepts: string[];
    }>;
    summary: string;
    detected_context?: string;
  };
  activeGoal?: { title: string; metric?: string; deadline?: string } | null;
  compact?: boolean;
}

// ── Component ──

export function AnalysisSpecPreview({
  config,
  tier,
  scopeResult,
  activeGoal,
  compact = false,
}: AnalysisSpecPreviewProps) {
  const tierConfig = TIERS[tier];
  const intent = config.intent;
  const hasIntent = intent?.user_role || intent?.primary_goal || intent?.context_type;
  const steps = getPipelineSteps(config, tier);
  const enabledSteps = steps.filter((s) => s.enabled);
  const disabledSteps = steps.filter((s) => !s.enabled);
  const hasExternal = config.crossSpace.externalKnowledge;
  const researchDepth = config.crossSpace.researchDepth ?? "training";
  const spaceCount = config.selectedSpaces.length;

  return (
    <div className={cn("space-y-3", compact ? "text-xs" : "text-sm")}>
      {/* 1. Analysis Overview */}
      <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">{tierConfig.icon}</span>
            <span className="font-semibold text-gray-800">{tierConfig.label} Analysis</span>
            <span className="rounded-full bg-interaxis-100 px-2 py-0.5 text-[10px] font-medium text-interaxis-700">
              {tierConfig.credits} credit{tierConfig.credits !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{TIME_ESTIMATES[tier] ?? tierConfig.time}</span>
            {spaceCount > 0 && (
              <>
                <span className="text-gray-300">|</span>
                <span>
                  {spaceCount} space{spaceCount !== 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 2. Your Lens (intent-based) */}
      {hasIntent && (
        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5">
          <div className="mb-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            Your lens
          </div>
          <div className="space-y-1">
            {intent?.user_role && (
              <div className="text-gray-700">
                <span className="font-medium text-gray-500">Role:</span>{" "}
                As {ROLE_OPTIONS.find((o) => o.value === intent.user_role)?.label?.toLowerCase() ?? intent.user_role},{" "}
                <span className="text-gray-600">
                  {ROLE_LENS[intent.user_role] ?? "custom perspective"}
                </span>
              </div>
            )}
            {intent?.primary_goal && (
              <div className="text-gray-700">
                <span className="font-medium text-gray-500">Goal:</span>{" "}
                Optimizing for{" "}
                <span className="text-gray-600">
                  {GOAL_DESCRIPTION[intent.primary_goal] ?? intent.primary_goal}
                </span>
              </div>
            )}
            {intent?.context_type && (
              <div className="text-gray-700">
                <span className="font-medium text-gray-500">Context:</span>{" "}
                Analyzing as{" "}
                <span className="text-gray-600">
                  {CONTEXT_DESCRIPTION[intent.context_type] ?? intent.context_type}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Pipeline Steps */}
      <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5">
        <div className="mb-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
          Pipeline steps
        </div>
        <div className="space-y-0.5">
          {enabledSteps.map((step, i) => (
            <div key={i} className="flex items-start gap-1.5 text-gray-700">
              <span className="mt-px text-green-500 flex-shrink-0">&#10003;</span>
              <span>{step.label}</span>
            </div>
          ))}
          {!compact &&
            disabledSteps.map((step, i) => (
              <div
                key={`disabled-${i}`}
                className="flex items-start gap-1.5 text-gray-300"
              >
                <span className="mt-px flex-shrink-0">&#8212;</span>
                <span className="line-through">{step.label}</span>
              </div>
            ))}
        </div>
      </div>

      {/* 4. Validation Checks (compact) */}
      <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5">
        <div className="mb-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
          Validation checks
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-gray-600">
          <span className="flex items-center gap-1">
            <span className="text-green-500">&#10003;</span> Quality scoring (6 dim)
          </span>
          {intent?.primary_goal && (
            <span className="flex items-center gap-1">
              <span className="text-green-500">&#10003;</span> Goal fitness
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="text-green-500">&#10003;</span> Coherence check
          </span>
          <span className="flex items-center gap-1">
            <span className="text-green-500">&#10003;</span> Gap-driven regen
          </span>
          <span className="flex items-center gap-1">
            <span className="text-green-500">&#10003;</span> Signal extraction
          </span>
        </div>
      </div>

      {/* 5. Research Focus (when external knowledge is enabled) */}
      {hasExternal && (
        <div className="rounded-lg border border-interaxis-100 bg-interaxis-50/30 px-3 py-2.5">
          <div className="mb-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            Research focus
          </div>
          <div className="space-y-1 text-gray-700">
            <div>
              <span className="font-medium text-gray-500">Depth:</span>{" "}
              <span className="rounded-full bg-interaxis-100 px-1.5 py-0.5 text-[10px] font-medium text-interaxis-700">
                {researchDepth}
              </span>
            </div>
            <div className="text-gray-500">
              The domain expert will search for external evidence, frameworks, and competitive context.
            </div>
          </div>
        </div>
      )}

      {/* Active goal display */}
      {activeGoal && (
        <div className="rounded-lg border border-amber-100 bg-amber-50/30 px-3 py-2.5">
          <div className="mb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            Goal-conditioned
          </div>
          <div className="text-gray-700">
            <span className="font-medium">{activeGoal.title}</span>
            {activeGoal.metric && (
              <span className="ml-1.5 text-gray-500">({activeGoal.metric})</span>
            )}
            {activeGoal.deadline && (
              <span className="ml-1.5 text-xs text-gray-400">
                by {new Date(activeGoal.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
