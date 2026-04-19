"use client";

import { useState } from "react";
import {
  Gauge,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";

// ── Types ──

export interface DecompositionQualityData {
  overall: number;
  metrics: {
    entityCount: { score: number; actual: number; target: number };
    edgeDensity: { score: number; actual: number; target: number };
    implicitRatio: { score: number; actual: number; target: number };
    manifoldCompleteness: { score: number; complete: number; required: number };
    orphanCount: { score: number; actual: number; target: number };
    edgePerEntity: {
      score: number;
      minEdges: number;
      meanEdges: number;
      belowThreshold: number;
    };
    descriptionDepth: { score: number; adequate: number; total: number };
    importanceDistribution: { score: number; fundamental: number; critical: number };
  };
  deficiencies: string[];
  retry_used: boolean;
  retry_improved: boolean;
  scored_at: string;
}

interface DecompositionQualityModuleProps {
  qualityData: DecompositionQualityData | null;
}

// ── Metric definitions ──

interface MetricDef {
  key: keyof DecompositionQualityData["metrics"];
  label: string;
  weight: string;
  context: string;
  formatDetail: (m: Record<string, number>) => string;
}

const METRICS: MetricDef[] = [
  {
    key: "entityCount",
    label: "Entity Count",
    weight: "15%",
    context: "Enough concepts extracted?",
    formatDetail: (m) => `${m.actual}/${m.target}`,
  },
  {
    key: "edgeDensity",
    label: "Edge Density",
    weight: "20%",
    context: "Rich enough connections?",
    formatDetail: (m) => `${m.actual}/${m.target}`,
  },
  {
    key: "implicitRatio",
    label: "Implicit Ratio",
    weight: "15%",
    context: "Hidden entities discovered?",
    formatDetail: (m) => `${m.actual}/${m.target}`,
  },
  {
    key: "manifoldCompleteness",
    label: "Manifold Completeness",
    weight: "10%",
    context: "Multi-dimensional positioning?",
    formatDetail: (m) => `${m.complete}/${m.required}`,
  },
  {
    key: "orphanCount",
    label: "Orphan Count",
    weight: "10%",
    context: "No isolated entities?",
    formatDetail: (m) => `${m.actual}/${m.target}`,
  },
  {
    key: "edgePerEntity",
    label: "Edge Per Entity",
    weight: "15%",
    context: "Well-connected graph?",
    formatDetail: (m) =>
      `mean ${m.meanEdges?.toFixed(1) ?? "?"}, ${m.belowThreshold ?? 0} below min`,
  },
  {
    key: "descriptionDepth",
    label: "Description Depth",
    weight: "10%",
    context: "Detailed enough descriptions?",
    formatDetail: (m) => `${m.adequate}/${m.total}`,
  },
  {
    key: "importanceDistribution",
    label: "Importance Distribution",
    weight: "5%",
    context: "Proper prioritization?",
    formatDetail: (m) =>
      `${m.fundamental ?? 0} fund. / ${m.critical ?? 0} crit.`,
  },
];

// ── Helpers ──

function scoreColor(score: number): string {
  if (score >= 0.8) return "text-emerald-600";
  if (score >= 0.6) return "text-amber-500";
  return "text-red-500";
}

function barBg(score: number): string {
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.6) return "bg-amber-400";
  return "bg-red-400";
}

function ringStroke(score: number): string {
  if (score >= 0.8) return "stroke-emerald-500";
  if (score >= 0.6) return "stroke-amber-500";
  return "stroke-red-500";
}

// ── Overall score ring (SVG) ──

function ScoreRing({ score }: { score: number }) {
  const size = 40;
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(score, 1));
  const pct = Math.round(score * 100);

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-gray-200"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={ringStroke(score)}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-[10px] font-bold",
          scoreColor(score)
        )}
      >
        {pct}%
      </span>
    </div>
  );
}

// ── Single metric bar row ──

function MetricBar({ def, metric }: { def: MetricDef; metric: Record<string, number> }) {
  const score = metric.score ?? 0;
  const pct = Math.round(score * 100);

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
      {/* Label row */}
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-[10px] font-medium text-gray-700 truncate">
          {def.label}
        </span>
        <span className="text-[9px] text-gray-400 truncate hidden sm:inline">
          {def.context}
        </span>
      </div>
      <span className={cn("text-[9px] font-bold tabular-nums", scoreColor(score))}>
        {pct}%
      </span>

      {/* Bar row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barBg(score))}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className="text-[9px] text-gray-400 tabular-nums w-[60px] text-right truncate">
          {def.formatDetail(metric)}
        </span>
      </div>
    </div>
  );
}

// ── Main component ──

export function DecompositionQualityModule({
  qualityData,
}: DecompositionQualityModuleProps) {
  const [defOpen, setDefOpen] = useState(false);

  if (!qualityData) return null;

  const { overall, metrics, deficiencies, retry_used, retry_improved } = qualityData;

  const retryBadge = retry_used ? (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium",
        retry_improved
          ? "bg-emerald-50 text-emerald-700"
          : "bg-gray-100 text-gray-500"
      )}
    >
      <RefreshCw className="h-2.5 w-2.5" />
      {retry_improved ? "Auto-improved" : "Retry attempted"}
      {retry_improved && (
        <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
      )}
    </span>
  ) : null;

  return (
    <DashboardCard
      title="Decomposition Quality"
      icon={<Gauge className="h-4 w-4" />}
      badge={retryBadge}
      defaultExpanded={false}
      collapsible
    >
      <div className="space-y-4">
        {/* Overall score row */}
        <div className="flex items-center gap-3">
          <ScoreRing score={overall} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-800">
              Overall Quality
            </p>
            <p className="text-[10px] text-gray-400">
              Weighted across 8 dimensions
            </p>
          </div>
          {overall >= 0.8 ? (
            <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-500 flex-shrink-0" />
          ) : overall >= 0.6 ? (
            <BarChart3 className="ml-auto h-4 w-4 text-amber-400 flex-shrink-0" />
          ) : (
            <XCircle className="ml-auto h-4 w-4 text-red-400 flex-shrink-0" />
          )}
        </div>

        {/* Metric bars */}
        <div className="space-y-2.5">
          {METRICS.map((def) => {
            const metric = metrics[def.key] as unknown as Record<string, number>;
            if (!metric) return null;
            return <MetricBar key={def.key} def={def} metric={metric} />;
          })}
        </div>

        {/* Deficiencies */}
        {deficiencies.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50">
            <button
              onClick={() => setDefOpen(!defOpen)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-[10px] font-semibold text-amber-700 flex-1">
                {deficiencies.length} deficienc{deficiencies.length === 1 ? "y" : "ies"} detected
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-amber-400 transition-transform duration-200",
                  defOpen && "rotate-180"
                )}
              />
            </button>
            {defOpen && (
              <ul className="space-y-1 px-3 pb-2.5">
                {deficiencies.map((d, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[10px] text-amber-800"
                  >
                    <span className="mt-0.5 h-1 w-1 rounded-full bg-amber-400 flex-shrink-0" />
                    {d}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
