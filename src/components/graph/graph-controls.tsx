"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { edgeDimensionStyles, nodeColors } from "@/lib/design-tokens";
import { Maximize2, Network, GitBranch, ArrowRight, TrendingUp, Globe, Map, Layers, Search, X, Clock, Target } from "lucide-react";
import type { AutoRefreshInterval } from "@/lib/hooks/use-auto-refresh";
import type { LayoutType } from "@/lib/graph/layout-engine";

interface GraphControlsProps {
  visibleDimensions: Set<string>;
  onToggleDimension: (dim: string) => void;
  onResetZoom: () => void;
  showExternal?: boolean;
  onToggleExternal?: () => void;
  /** Current layout type */
  layoutType?: LayoutType;
  /** Callback when layout type changes */
  onLayoutChange?: (type: LayoutType) => void;
  /** Inferred layout info (from layout engine) */
  inferredLayout?: { primary: LayoutType; reasoning: string } | null;
  /** Search + filter props */
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  activeCategories?: Set<string>;
  onToggleCategory?: (category: string) => void;
  activeImportances?: Set<string>;
  onToggleImportance?: (importance: string) => void;
  totalCount?: number;
  filteredCount?: number;
  /** Auto-refresh interval state */
  autoRefreshInterval?: AutoRefreshInterval;
  onAutoRefreshChange?: (v: AutoRefreshInterval) => void;
  /** Whether a reasoning run is currently in progress */
  autoRefreshRunning?: boolean;
}

const dimensionLabels: Record<string, string> = {
  structural: "Structural",
  functional: "Functional",
  temporal: "Temporal",
  causal: "Causal",
  correlational: "Correlational",
  logical: "Logical",
  epistemic: "Epistemic",
  comparative: "Comparative",
  agentive: "Agentive",
};

const layoutOptions: Array<{ type: LayoutType; label: string; icon: React.ReactNode }> = [
  { type: "force", label: "Network", icon: <Network className="h-3 w-3" /> },
  { type: "map", label: "Map", icon: <Map className="h-3 w-3" /> },
  { type: "layered", label: "Layered", icon: <Layers className="h-3 w-3" /> },
  { type: "sphere", label: "Sphere", icon: <Target className="h-3 w-3" /> },
  { type: "flowchart", label: "Flow", icon: <ArrowRight className="h-3 w-3" /> },
  { type: "hierarchy", label: "Tree", icon: <GitBranch className="h-3 w-3" /> },
  { type: "causal", label: "Causal", icon: <TrendingUp className="h-3 w-3" /> },
  { type: "dense", label: "Dense", icon: <Globe className="h-3 w-3" /> },
];

const categoryConfig: Record<string, { label: string; color: string }> = {
  concrete: { label: "Concrete", color: nodeColors.concrete.fill },
  abstract: { label: "Abstract", color: nodeColors.abstract.fill },
  process: { label: "Process", color: nodeColors.process.fill },
  relational: { label: "Relational", color: nodeColors.relational.fill },
  epistemic: { label: "Epistemic", color: nodeColors.epistemic.fill },
};

const importanceConfig: Record<string, { label: string; color: string }> = {
  fundamental: { label: "Fundamental", color: "#059669" },
  critical: { label: "Critical", color: "#DC2626" },
  important: { label: "Important", color: "#D97706" },
  moderate: { label: "Moderate", color: "#6B7280" },
};

export function GraphControls({
  visibleDimensions,
  onToggleDimension,
  onResetZoom,
  showExternal = true,
  onToggleExternal,
  layoutType = "force",
  onLayoutChange,
  inferredLayout,
  searchQuery = "",
  onSearchChange,
  activeCategories,
  onToggleCategory,
  activeImportances,
  onToggleImportance,
  totalCount,
  filteredCount,
  autoRefreshInterval,
  onAutoRefreshChange,
  autoRefreshRunning = false,
}: GraphControlsProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  // Cmd+K / Ctrl+K to focus search
  useEffect(() => {
    if (!onSearchChange) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        onSearchChange("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSearchChange]);

  const hasFilters = searchQuery.length > 0 ||
    (activeCategories && activeCategories.size < Object.keys(categoryConfig).length) ||
    (activeImportances && activeImportances.size < Object.keys(importanceConfig).length);

  return (
    <div className="flex flex-col gap-2">
      {/* Search + entity filter row */}
      {onSearchChange && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 backdrop-blur-sm">
          {/* Search input */}
          <div className="relative flex items-center">
            <Search className="absolute left-2 h-3 w-3 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search entities… ⌘K"
              className="h-6 w-40 rounded-md border border-gray-200 bg-white pl-7 pr-6 text-[11px] text-gray-700 placeholder-gray-400 outline-none focus:border-interaxis-300 focus:ring-1 focus:ring-interaxis-200 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 rounded-sm p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>

          {/* Category chips */}
          {onToggleCategory && activeCategories && (
            <>
              <div className="mx-0.5 h-4 w-px bg-gray-200" />
              {Object.entries(categoryConfig).map(([cat, cfg]) => {
                const isActive = activeCategories.has(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => onToggleCategory(cat)}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all",
                      isActive
                        ? "bg-gray-100 text-gray-700"
                        : "text-gray-400 opacity-40"
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: cfg.color, opacity: isActive ? 1 : 0.3 }}
                    />
                    {cfg.label}
                  </button>
                );
              })}
            </>
          )}

          {/* Importance chips */}
          {onToggleImportance && activeImportances && (
            <>
              <div className="mx-0.5 h-4 w-px bg-gray-200" />
              {Object.entries(importanceConfig).map(([imp, cfg]) => {
                const isActive = activeImportances.has(imp);
                return (
                  <button
                    key={imp}
                    onClick={() => onToggleImportance(imp)}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all",
                      isActive
                        ? "text-gray-700"
                        : "text-gray-400 opacity-40"
                    )}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-sm"
                      style={{ backgroundColor: cfg.color, opacity: isActive ? 1 : 0.3 }}
                    />
                    {cfg.label}
                  </button>
                );
              })}
            </>
          )}

          {/* Count + reset */}
          {totalCount != null && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400">
                {filteredCount != null && filteredCount !== totalCount
                  ? `${filteredCount}/${totalCount}`
                  : totalCount}
              </span>
              {hasFilters && (
                <button
                  onClick={() => {
                    onSearchChange("");
                    if (onToggleCategory && activeCategories) {
                      Object.keys(categoryConfig).forEach((c) => {
                        if (!activeCategories.has(c)) onToggleCategory(c);
                      });
                    }
                    if (onToggleImportance && activeImportances) {
                      Object.keys(importanceConfig).forEach((i) => {
                        if (!activeImportances.has(i)) onToggleImportance(i);
                      });
                    }
                  }}
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-interaxis-600 hover:bg-interaxis-50 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Layout selector row */}
      {onLayoutChange && (
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white/80 px-3 py-1.5 backdrop-blur-sm">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mr-1">
            Layout
          </span>
          {layoutOptions.map((opt) => {
            const isActive = layoutType === opt.type;
            const isInferred = inferredLayout?.primary === opt.type;
            return (
              <button
                key={opt.type}
                onClick={() => onLayoutChange(opt.type)}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                  isActive
                    ? "bg-interaxis-100 text-interaxis-700 shadow-sm"
                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                )}
                title={isInferred ? `Recommended: ${inferredLayout?.reasoning}` : undefined}
              >
                {opt.icon}
                {opt.label}
                {isInferred && !isActive && (
                  <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" title="Recommended" />
                )}
              </button>
            );
          })}

          {/* Auto-refresh control */}
          {onAutoRefreshChange && (
            <div className="ml-auto flex items-center gap-1.5 border-l border-gray-200 pl-2">
              <Clock className="h-3 w-3 text-gray-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Auto
              </span>
              <select
                value={autoRefreshInterval ?? "off"}
                onChange={(e) => onAutoRefreshChange(e.target.value as AutoRefreshInterval)}
                className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-700 focus:border-interaxis-400 focus:outline-none"
                title="Auto-run reasoning agent on a schedule"
              >
                <option value="off">Off</option>
                <option value="5m">5 min</option>
                <option value="15m">15 min</option>
                <option value="1h">1 hour</option>
              </select>
              {autoRefreshInterval && autoRefreshInterval !== "off" && (
                <span className="flex items-center gap-1">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full animate-pulse",
                      autoRefreshRunning ? "bg-amber-400" : "bg-emerald-400",
                    )}
                    title={autoRefreshRunning ? "Running…" : "Scheduled"}
                  />
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dimension filter row */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white/80 px-3 py-2 backdrop-blur-sm">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Filter
        </span>
        {Object.entries(dimensionLabels).map(([dim, label]) => {
          const style = edgeDimensionStyles[dim];
          const isActive = visibleDimensions.has(dim);
          return (
            <button
              key={dim}
              onClick={() => onToggleDimension(dim)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                isActive
                  ? "bg-gray-100 text-gray-700"
                  : "text-gray-400 opacity-50"
              )}
            >
              <span
                className="h-2 w-4 rounded-sm"
                style={{
                  backgroundColor: style?.color ?? "#888",
                  opacity: isActive ? 1 : 0.3,
                }}
              />
              {label}
            </button>
          );
        })}
        {/* External toggle */}
        {onToggleExternal && (
          <>
            <div className="mx-1 h-4 w-px bg-gray-200" />
            <button
              onClick={onToggleExternal}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                showExternal
                  ? "bg-purple-50 text-purple-600"
                  : "text-gray-400 opacity-50"
              )}
            >
              <span
                className="h-2 w-2 rounded-full border border-current"
                style={{ borderStyle: "dashed" }}
              />
              External
            </button>
          </>
        )}

        <div className="ml-auto flex gap-1">
          <button
            onClick={onResetZoom}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Reset zoom"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
