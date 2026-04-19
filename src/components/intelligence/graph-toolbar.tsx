"use client";

import { cn } from "@/lib/utils";
import { X, Download, SlidersHorizontal, Network, Table2, Clock, GitBranch } from "lucide-react";
import type { GraphLayoutMode } from "./graph-filter-rail";
import type { SemanticZoomLevel } from "./knowledge-graph";

interface GraphToolbarProps {
  activeView: "graph" | "matrix" | "timeline" | "tree";
  onViewChange: (view: "graph" | "matrix" | "timeline" | "tree") => void;
  focusedEntity: { id: string; name: string } | null;
  onClearFocus: () => void;
  onExport: () => void;
  onFilterToggle: () => void;
  layout: GraphLayoutMode;
  semanticZoom: SemanticZoomLevel;
  onSemanticZoomChange: (level: SemanticZoomLevel) => void;
}

const VIEW_TABS: Array<{ key: "graph" | "matrix" | "timeline" | "tree"; label: string; icon: React.ReactNode; available: boolean }> = [
  { key: "graph", label: "Graph", icon: <Network className="h-3.5 w-3.5" />, available: true },
  { key: "matrix", label: "Matrix", icon: <Table2 className="h-3.5 w-3.5" />, available: false },
  { key: "timeline", label: "Timeline", icon: <Clock className="h-3.5 w-3.5" />, available: false },
  { key: "tree", label: "Tree", icon: <GitBranch className="h-3.5 w-3.5" />, available: false },
];

const ZOOM_LEVELS: Array<{ level: SemanticZoomLevel; label: string }> = [
  { level: 1, label: "Macro" },
  { level: 2, label: "Cluster" },
  { level: 3, label: "Atoms" },
  { level: 4, label: "Sources" },
];

export function GraphToolbar({
  activeView,
  onViewChange,
  focusedEntity,
  onClearFocus,
  onExport,
  onFilterToggle,
  semanticZoom,
  onSemanticZoomChange,
}: GraphToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-100 flex-shrink-0">
      {/* View tabs */}
      <div className="flex rounded-md border border-gray-200 overflow-hidden">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => tab.available && onViewChange(tab.key)}
            disabled={!tab.available}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium transition-colors border-r border-gray-200 last:border-r-0",
              activeView === tab.key
                ? "bg-interaxis-50 text-interaxis-700"
                : tab.available
                  ? "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                  : "text-gray-300 cursor-not-allowed"
            )}
            title={!tab.available ? "Coming soon" : undefined}
          >
            {tab.icon}
            <span className="hidden lg:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Focus pill */}
      {focusedEntity && (
        <div className="flex items-center gap-1.5 rounded-full bg-interaxis-50 border border-interaxis-200 px-2.5 py-1 text-[10px] text-interaxis-700 font-medium">
          <span className="truncate max-w-32">Focused on {focusedEntity.name}</span>
          <button onClick={onClearFocus} className="p-0.5 rounded-full hover:bg-interaxis-100 transition-colors">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Semantic zoom selector */}
      <div className="flex items-center gap-0.5 ml-auto">
        <span className="text-[9px] text-gray-400 mr-1">Detail:</span>
        {ZOOM_LEVELS.map(({ level, label }) => (
          <button
            key={level}
            onClick={() => onSemanticZoomChange(level)}
            className={cn(
              "px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
              semanticZoom === level
                ? "bg-gray-800 text-white"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 border-l border-gray-100 pl-2 ml-1">
        <button
          onClick={onFilterToggle}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Toggle filter rail"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onExport}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Export graph"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
