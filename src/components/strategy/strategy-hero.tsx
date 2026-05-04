"use client";

import { cn } from "@/lib/utils";
import {
  Zap,
  Target,
  GitBranch,
  Shield,
} from "lucide-react";
import { ReadyToShipMeter } from "./ready-to-ship-meter";

interface StrategyHeroProps {
  title: string;
  summary: string;
  confidence: number;
  posture: string;
  // Phase 1b — additional readiness inputs so the hero can render the
  // composite meter (coverage·0.30 + confidence·0.25 + provenance·0.25 +
  // coherence·0.20) instead of just the LLM-self-reported confidence.
  // All optional; the meter falls back to neutral 50 for missing values
  // and only renders the bars it has data for.
  coveragePct?: number | null;
  provenanceScore?: number | null;
  coherenceScore?: number | null;
}

const postureConfig: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  aggressive_growth: { label: "Aggressive Growth", color: "text-green-700", bg: "bg-green-50", icon: <Zap className="h-3.5 w-3.5" /> },
  cautious_validation: { label: "Cautious Validation", color: "text-blue-700", bg: "bg-blue-50", icon: <Target className="h-3.5 w-3.5" /> },
  pivot_exploration: { label: "Pivot Exploration", color: "text-purple-700", bg: "bg-purple-50", icon: <GitBranch className="h-3.5 w-3.5" /> },
  consolidation: { label: "Consolidation", color: "text-amber-700", bg: "bg-amber-50", icon: <Shield className="h-3.5 w-3.5" /> },
  defensive: { label: "Defensive", color: "text-red-700", bg: "bg-red-50", icon: <Shield className="h-3.5 w-3.5" /> },
};

export function StrategyHero({
  title,
  summary,
  confidence,
  posture,
  coveragePct = null,
  provenanceScore = null,
  coherenceScore = null,
}: StrategyHeroProps) {
  const p = postureConfig[posture] ?? postureConfig.cautious_validation;

  return (
    <div className="pt-6 pb-4">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-[28px] font-bold leading-tight tracking-tight text-gray-900">
            {title}
          </h2>
          <p className="mt-2 text-[17px] leading-relaxed text-gray-500">
            {summary}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-1 max-w-[300px]">
          <ReadyToShipMeter
            inputs={{
              confidence,
              coverage_pct: coveragePct,
              provenance_score: provenanceScore,
              coherence_score: coherenceScore,
            }}
            compact
          />
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap",
            p.bg, p.color
          )}>
            {p.icon}
            {p.label}
          </span>
        </div>
      </div>
    </div>
  );
}
