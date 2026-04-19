"use client";

import { useState } from "react";
import { Layers, Loader2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IterativeReasoningStage } from "@/lib/hooks/use-iterative-reasoning";
import { STAGE_LABELS } from "@/lib/hooks/use-iterative-reasoning";

interface DeepenButtonProps {
  stage: IterativeReasoningStage;
  currentIteration: number;
  maxIterations: number;
  isRunning: boolean;
  onRun: (maxIterations?: number) => void;
  onStop: () => void;
}

const DEEPEN_COLOR = "#6366F1"; // indigo

export function DeepenButton({
  stage,
  currentIteration,
  maxIterations,
  isRunning,
  onRun,
  onStop,
}: DeepenButtonProps) {
  const [showPicker, setShowPicker] = useState(false);

  if (isRunning) {
    return (
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow-sm"
          style={{ backgroundColor: DEEPEN_COLOR }}
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            {maxIterations > 1 && (
              <span className="mr-1 opacity-80">
                {currentIteration}/{maxIterations}
              </span>
            )}
            {STAGE_LABELS[stage] || "Processing\u2026"}
          </span>
        </div>
        <button
          onClick={onStop}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          <Square className="h-2.5 w-2.5" />
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-0.5">
      {/* Main button — 1 iteration */}
      <button
        onClick={() => onRun(1)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
          "border border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
        )}
      >
        <Layers className="h-3 w-3" />
        Deepen
      </button>

      {/* Iteration picker toggle */}
      <button
        onClick={() => setShowPicker(!showPicker)}
        className="rounded-md px-1 py-1.5 text-[10px] text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        title="Choose iteration count"
      >
        &#x25BE;
      </button>

      {/* Dropdown picker */}
      {showPicker && (
        <div className="absolute left-0 top-full z-50 mt-1 flex flex-col rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => {
                setShowPicker(false);
                onRun(n);
              }}
              className="px-4 py-1.5 text-left text-xs text-gray-600 hover:bg-indigo-50 hover:text-indigo-700"
            >
              {n} iteration{n > 1 ? "s" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
