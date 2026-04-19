"use client";

import { ArrowUp, ArrowDown, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  IterationDelta,
  IterativeReasoningStage,
} from "@/lib/hooks/use-iterative-reasoning";
import { STAGE_LABELS } from "@/lib/hooks/use-iterative-reasoning";

interface IterationResultsCardProps {
  deltas: IterationDelta[];
  isRunning: boolean;
  stage: IterativeReasoningStage;
  currentIteration: number;
  totalAddedEdges: number;
  totalAddedCycles: number;
  onReset: () => void;
}

function ConfidenceDelta({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  if (current == null) return <span className="text-gray-400">--</span>;
  if (previous == null) {
    return <span className="text-gray-600">{current}%</span>;
  }
  const diff = current - previous;
  if (diff > 0) {
    return (
      <span className="flex items-center gap-0.5 text-green-600">
        {current}%
        <ArrowUp className="h-2.5 w-2.5" />
        <span className="text-[9px] opacity-70">+{diff}</span>
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span className="flex items-center gap-0.5 text-red-500">
        {current}%
        <ArrowDown className="h-2.5 w-2.5" />
        <span className="text-[9px] opacity-70">{diff}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-gray-500">
      {current}%
      <Minus className="h-2.5 w-2.5" />
    </span>
  );
}

export function IterationResultsCard({
  deltas,
  isRunning,
  stage,
  currentIteration,
  totalAddedEdges,
  totalAddedCycles,
  onReset,
}: IterationResultsCardProps) {
  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
          Reasoning Iterations
        </h4>
        {!isRunning && deltas.length > 0 && (
          <button
            onClick={onReset}
            className="text-gray-400 hover:text-gray-600"
            title="Clear results"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Running indicator */}
      {isRunning && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-medium text-indigo-700">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
            Iteration {currentIteration}: {STAGE_LABELS[stage]}
          </div>
          {/* Mini progress dots */}
          <div className="mt-1.5 flex gap-1">
            {["reasoning", "reevaluate", "resynthesize", "strategy"].map(
              (step, i) => {
                const stageMap: Record<string, number> = {
                  reasoning: 0,
                  reevaluating: 1,
                  resynthesizing: 2,
                  strategizing: 3,
                };
                const currentIdx = stageMap[stage] ?? -1;
                return (
                  <div
                    key={step}
                    className={cn(
                      "h-1 flex-1 rounded-full transition-colors",
                      i < currentIdx
                        ? "bg-indigo-400"
                        : i === currentIdx
                          ? "animate-pulse bg-indigo-500"
                          : "bg-gray-200"
                    )}
                  />
                );
              }
            )}
          </div>
        </div>
      )}

      {/* Iteration rows */}
      {deltas.map((d, i) => (
        <div
          key={d.iteration}
          className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-bold text-indigo-700">
                {d.iteration}
              </span>
              <span className="text-[11px] text-gray-600">
                <span className="font-medium text-green-700">
                  +{d.addedEdges}
                </span>{" "}
                edge{d.addedEdges !== 1 ? "s" : ""}
                {d.addedCycles > 0 && (
                  <>
                    {", "}
                    <span className="font-medium text-amber-700">
                      +{d.addedCycles}
                    </span>{" "}
                    cycle{d.addedCycles !== 1 ? "s" : ""}
                  </>
                )}
              </span>
            </div>
            <span className="text-[10px] text-gray-400">
              {(d.durationMs / 1000).toFixed(0)}s
            </span>
          </div>

          {/* Strategy info */}
          {d.strategyTitle && (
            <div className="mt-1 flex items-center justify-between text-[10px]">
              <span className="truncate text-gray-500" title={d.strategyTitle}>
                {d.strategyTitle}
              </span>
              <span className="ml-2 flex-shrink-0">
                <ConfidenceDelta
                  current={d.strategyConfidence}
                  previous={i > 0 ? deltas[i - 1].strategyConfidence : null}
                />
              </span>
            </div>
          )}
        </div>
      ))}

      {/* Cumulative totals */}
      {deltas.length > 1 && (
        <div className="flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50/30 px-3 py-1.5 text-[10px] font-medium text-indigo-700">
          <span>
            Total: +{totalAddedEdges} edges, +{totalAddedCycles} cycles
          </span>
          <span>{deltas.length} iterations</span>
        </div>
      )}
    </div>
  );
}
