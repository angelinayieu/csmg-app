"use client";

import { cn } from "@/lib/utils";
import {
  Zap,
  Target,
  GitBranch,
  Shield,
} from "lucide-react";

interface StrategyHeroProps {
  title: string;
  summary: string;
  confidence: number;
  posture: string;
}

const postureConfig: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  aggressive_growth: { label: "Aggressive Growth", color: "text-green-700", bg: "bg-green-50", icon: <Zap className="h-3.5 w-3.5" /> },
  cautious_validation: { label: "Cautious Validation", color: "text-blue-700", bg: "bg-blue-50", icon: <Target className="h-3.5 w-3.5" /> },
  pivot_exploration: { label: "Pivot Exploration", color: "text-purple-700", bg: "bg-purple-50", icon: <GitBranch className="h-3.5 w-3.5" /> },
  consolidation: { label: "Consolidation", color: "text-amber-700", bg: "bg-amber-50", icon: <Shield className="h-3.5 w-3.5" /> },
  defensive: { label: "Defensive", color: "text-red-700", bg: "bg-red-50", icon: <Shield className="h-3.5 w-3.5" /> },
};

function ConfidenceRing({ value }: { value: number }) {
  const size = 36;
  const radius = (size - 5) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 70 ? "#22C55E" : value >= 40 ? "#F59E0B" : "#EF4444";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F3F4F6" strokeWidth={3.5} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={3.5}
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-700" />
      </svg>
      <span className="absolute text-xs font-bold text-gray-900">{value}</span>
    </div>
  );
}

export function StrategyHero({ title, summary, confidence, posture }: StrategyHeroProps) {
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
        <div className="flex flex-col items-center gap-2 flex-shrink-0 pt-1">
          <ConfidenceRing value={confidence} />
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
