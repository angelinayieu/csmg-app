"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReasoningOp } from "@/lib/hooks/use-reasoning";

interface ReasoningToolbarProps {
  activeOp: ReasoningOp | null;
  loading: boolean;
  onRun: (op: ReasoningOp) => void;
  onClear: () => void;
}

const operations: { op: ReasoningOp; label: string; color: string }[] = [
  { op: "centrality", label: "Leverage", color: "#007AFF" },
  { op: "cycles", label: "Loops", color: "#FF9500" },
  { op: "cascade", label: "Risks", color: "#FF3B30" },
  { op: "path", label: "Paths", color: "#34C759" },
  { op: "link_prediction", label: "Predict", color: "#AF52DE" },
];

export function ReasoningToolbar({
  activeOp,
  loading,
  onRun,
  onClear,
}: ReasoningToolbarProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 text-[11px] font-medium text-gray-400">
        Reasoning:
      </span>
      {operations.map(({ op, label, color }) => {
        const isActive = activeOp === op;
        return (
          <button
            key={op}
            onClick={() => (isActive ? onClear() : onRun(op))}
            disabled={loading && !isActive}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
              isActive
                ? "text-white shadow-sm"
                : "border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50",
              loading && !isActive && "cursor-not-allowed opacity-40"
            )}
            style={{
              backgroundColor: isActive ? color : undefined,
              borderColor: isActive ? color : undefined,
            }}
          >
            {loading && isActive && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {label}
          </button>
        );
      })}
      {activeOp && !loading && (
        <button
          onClick={onClear}
          className="ml-1 text-[10px] text-gray-400 hover:text-gray-600"
        >
          Clear
        </button>
      )}
    </div>
  );
}
