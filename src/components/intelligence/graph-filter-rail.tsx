"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Circle as CircleIcon,
  GitBranch,
  Grid3X3,
} from "lucide-react";
import type { EpistemicNodeType, ExternalCategory } from "@/types/intelligence";
import { CATEGORY_CONFIG } from "@/types/intelligence";

// ── Config ──

export const EPISTEMIC_CONFIG: Record<
  EpistemicNodeType,
  { label: string; color: string; bg: string; stroke: string }
> = {
  claim:      { label: "Claim",       color: "text-blue-600",   bg: "bg-blue-50",    stroke: "#3B82F6" },
  evidence:   { label: "Evidence",    color: "text-green-600",  bg: "bg-green-50",   stroke: "#10B981" },
  hypothesis: { label: "Hypothesis",  color: "text-purple-600", bg: "bg-purple-50",  stroke: "#8B5CF6" },
  pattern:    { label: "Pattern",     color: "text-cyan-600",   bg: "bg-cyan-50",    stroke: "#06B6D4" },
  question:   { label: "Question",    color: "text-amber-600",  bg: "bg-amber-50",   stroke: "#F59E0B" },
  actor:      { label: "Actor",       color: "text-red-600",    bg: "bg-red-50",     stroke: "#EF4444" },
};

export const EDGE_STYLE_CONFIG: Record<
  string,
  { label: string; strokeStyle: "solid" | "dashed" | "dotted"; color: string }
> = {
  supports:     { label: "Supports",     strokeStyle: "solid",  color: "#10B981" },
  contradicts:  { label: "Contradicts",  strokeStyle: "dashed", color: "#EF4444" },
  causes:       { label: "Causes",       strokeStyle: "solid",  color: "#3B82F6" },
  depends:      { label: "Depends On",   strokeStyle: "solid",  color: "#8B5CF6" },
  correlates:   { label: "Correlates",   strokeStyle: "dotted", color: "#6B7280" },
};

export type GraphLayoutMode = "force" | "radial" | "tree" | "grid";

interface GraphFilterRailProps {
  graphLayout: GraphLayoutMode;
  onLayoutChange: (layout: GraphLayoutMode) => void;

  epistemicTypes: Map<EpistemicNodeType, number>;
  domainCategories: Map<ExternalCategory, number>;
  activeEpistemicTypes: Set<EpistemicNodeType>;
  activeDomainCategories: Set<ExternalCategory>;
  onToggleEpistemicType: (type: EpistemicNodeType) => void;
  onToggleDomainCategory: (category: ExternalCategory) => void;
  taxonomyMode: "epistemic" | "domain";
  onTaxonomyModeChange: (mode: "epistemic" | "domain") => void;

  edgeTypes: Map<string, number>;
  activeEdgeTypes: Set<string>;
  onToggleEdgeType: (type: string) => void;

  minCredibility: number;
  onMinCredibilityChange: (value: number) => void;
  minConnectionStrength: number;
  onMinConnectionStrengthChange: (value: number) => void;
  clusterThreshold: number;
  onClusterThresholdChange: (value: number) => void;

  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const LAYOUT_OPTIONS: Array<{ key: GraphLayoutMode; label: string; icon: React.ReactNode }> = [
  { key: "force", label: "Force", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  { key: "radial", label: "Radial", icon: <CircleIcon className="h-3.5 w-3.5" /> },
  { key: "tree", label: "Tree", icon: <GitBranch className="h-3.5 w-3.5" /> },
  { key: "grid", label: "Grid", icon: <Grid3X3 className="h-3.5 w-3.5" /> },
];

// ── Collapsible section ──

function FilterSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition-colors"
      >
        {title}
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="px-3 pb-3 space-y-1.5">{children}</div>}
    </div>
  );
}

// ── Slider component ──

function FilterSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-gray-500">{label}</span>
        <span className="text-gray-700 font-medium tabular-nums">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-interaxis-500"
      />
    </div>
  );
}

export function GraphFilterRail({
  graphLayout,
  onLayoutChange,
  epistemicTypes,
  domainCategories,
  activeEpistemicTypes,
  activeDomainCategories,
  onToggleEpistemicType,
  onToggleDomainCategory,
  taxonomyMode,
  onTaxonomyModeChange,
  edgeTypes,
  activeEdgeTypes,
  onToggleEdgeType,
  minCredibility,
  onMinCredibilityChange,
  minConnectionStrength,
  onMinConnectionStrengthChange,
  clusterThreshold,
  onClusterThresholdChange,
  collapsed = false,
  onCollapsedChange,
}: GraphFilterRailProps) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center w-8 pt-2">
        <button
          onClick={() => onCollapsedChange?.(false)}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Expand filter rail"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-44 flex-shrink-0 rounded-lg border border-gray-200 bg-white overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="text-[11px] font-semibold text-gray-700">Filters</span>
        <button
          onClick={() => onCollapsedChange?.(true)}
          className="p-0.5 rounded text-gray-400 hover:text-gray-600 transition-colors"
          title="Collapse filter rail"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Layout */}
      <FilterSection title="Layout">
        <div className="grid grid-cols-2 gap-1">
          {LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => onLayoutChange(opt.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-medium transition-all",
                graphLayout === opt.key
                  ? "bg-interaxis-50 text-interaxis-700 border border-interaxis-200"
                  : "text-gray-500 border border-gray-100 hover:border-gray-200 hover:bg-gray-50"
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* Node Types — with taxonomy toggle */}
      <FilterSection title="Node Types">
        {/* Taxonomy toggle */}
        <div className="flex rounded-md border border-gray-200 overflow-hidden mb-2">
          <button
            onClick={() => onTaxonomyModeChange("epistemic")}
            className={cn(
              "flex-1 text-[9px] font-medium py-1 transition-colors",
              taxonomyMode === "epistemic"
                ? "bg-interaxis-50 text-interaxis-700"
                : "text-gray-400 hover:text-gray-600"
            )}
          >
            Epistemic
          </button>
          <button
            onClick={() => onTaxonomyModeChange("domain")}
            className={cn(
              "flex-1 text-[9px] font-medium py-1 transition-colors border-l border-gray-200",
              taxonomyMode === "domain"
                ? "bg-interaxis-50 text-interaxis-700"
                : "text-gray-400 hover:text-gray-600"
            )}
          >
            Domain
          </button>
        </div>

        {/* Type rows */}
        {taxonomyMode === "epistemic" ? (
          Array.from(epistemicTypes.entries()).map(([type, count]) => {
            const config = EPISTEMIC_CONFIG[type];
            const active = activeEpistemicTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => onToggleEpistemicType(type)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-[11px] transition-all",
                  active ? "opacity-100" : "opacity-40"
                )}
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: config.stroke }}
                />
                <span className={cn("flex-1 text-left text-gray-700", !active && "text-gray-400")}>
                  {config.label}
                </span>
                <span className="text-[10px] text-gray-400 tabular-nums">{count}</span>
              </button>
            );
          })
        ) : (
          Array.from(domainCategories.entries()).map(([cat, count]) => {
            const config = CATEGORY_CONFIG[cat];
            const active = activeDomainCategories.has(cat);
            return (
              <button
                key={cat}
                onClick={() => onToggleDomainCategory(cat)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-[11px] transition-all",
                  active ? "opacity-100" : "opacity-40"
                )}
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: config?.stroke ?? "#6B7280" }}
                />
                <span className={cn("flex-1 text-left text-gray-700", !active && "text-gray-400")}>
                  {config?.label ?? cat}
                </span>
                <span className="text-[10px] text-gray-400 tabular-nums">{count}</span>
              </button>
            );
          })
        )}
      </FilterSection>

      {/* Connections */}
      <FilterSection title="Connections" defaultOpen={false}>
        {Array.from(edgeTypes.entries()).map(([type, count]) => {
          const config = EDGE_STYLE_CONFIG[type.toLowerCase()];
          const active = activeEdgeTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => onToggleEdgeType(type)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-[11px] transition-all",
                active ? "opacity-100" : "opacity-40"
              )}
            >
              <svg width="16" height="8" className="flex-shrink-0">
                <line
                  x1="0" y1="4" x2="16" y2="4"
                  stroke={config?.color ?? "#6B7280"}
                  strokeWidth="2"
                  strokeDasharray={
                    config?.strokeStyle === "dashed" ? "4,2" :
                    config?.strokeStyle === "dotted" ? "2,2" : "none"
                  }
                />
              </svg>
              <span className={cn("flex-1 text-left text-gray-700", !active && "text-gray-400")}>
                {config?.label ?? type}
              </span>
              <span className="text-[10px] text-gray-400 tabular-nums">{count}</span>
            </button>
          );
        })}
      </FilterSection>

      {/* Filters (sliders) */}
      <FilterSection title="Thresholds" defaultOpen={false}>
        <FilterSlider
          label="Min credibility"
          value={minCredibility}
          min={0}
          max={1}
          step={0.05}
          displayValue={minCredibility.toFixed(2)}
          onChange={onMinCredibilityChange}
        />
        <FilterSlider
          label="Min connections"
          value={minConnectionStrength}
          min={0}
          max={10}
          step={1}
          displayValue={String(minConnectionStrength)}
          onChange={onMinConnectionStrengthChange}
        />
        <FilterSlider
          label="Cluster size"
          value={clusterThreshold}
          min={1}
          max={20}
          step={1}
          displayValue={`≥${clusterThreshold}`}
          onChange={onClusterThresholdChange}
        />
      </FilterSection>
    </div>
  );
}
