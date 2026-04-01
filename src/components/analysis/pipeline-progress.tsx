"use client";

import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelinePhase, SpaceProgress } from "@/types/orchestration";

interface PipelineProgressProps {
  phase: PipelinePhase;
  spaces: SpaceProgress[];
  bridgeCount: number;
  contradictionCount: number;
  error: string | null;
}

function PhaseRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-5 flex-shrink-0">
        {status === "running" && (
          <Loader2 className="h-4 w-4 animate-spin text-interaxis-500" />
        )}
        {status === "done" && (
          <Check className="h-4 w-4 text-green-500" />
        )}
        {status === "pending" && (
          <div className="mx-auto h-2 w-2 rounded-full bg-gray-300" />
        )}
        {status === "error" && (
          <div className="mx-auto h-2 w-2 rounded-full bg-red-500" />
        )}
      </div>
      <span
        className={cn(
          "text-sm",
          status === "done"
            ? "text-gray-700"
            : status === "running"
              ? "font-medium text-gray-900"
              : "text-gray-400"
        )}
      >
        {label}
      </span>
      {detail && (
        <span className="ml-auto text-xs text-gray-400">{detail}</span>
      )}
    </div>
  );
}

export function PipelineProgress({
  phase,
  spaces,
  bridgeCount,
  contradictionCount,
  error,
}: PipelineProgressProps) {
  const phaseOrder: PipelinePhase[] = [
    "scope",
    "decomposing",
    "critiquing",
    "augmenting",
    "weaving",
    "synthesizing",
  ];
  const currentIdx = phaseOrder.indexOf(phase);

  function getStatus(p: PipelinePhase) {
    const idx = phaseOrder.indexOf(p);
    if (phase === "complete") return "done" as const;
    if (phase === "error" && idx <= currentIdx) return "error" as const;
    if (idx < currentIdx) return "done" as const;
    if (idx === currentIdx) return "running" as const;
    return "pending" as const;
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
      {/* Main phases */}
      <PhaseRow
        label="Mapping scope..."
        status={getStatus("scope")}
        detail={
          spaces.length > 0 ? `${spaces.length} areas identified` : undefined
        }
      />

      {/* Per-space progress */}
      {spaces.length > 0 && (
        <div className="ml-5 border-l border-gray-200 pl-3">
          {spaces.map((space) => {
            const isDone = space.phase === "done";
            const isActive = space.phase !== "pending" && !isDone;
            const detail = isDone
              ? `${space.entityCount ?? 0} · ${space.edgeCount ?? 0}${space.addedEdges ? ` (+${space.addedEdges})` : ""}`
              : undefined;

            return (
              <div key={space.index} className="flex items-center gap-2 py-1">
                <div className="w-4 flex-shrink-0">
                  {isDone && <Check className="h-3 w-3 text-green-500" />}
                  {isActive && (
                    <Loader2 className="h-3 w-3 animate-spin text-interaxis-500" />
                  )}
                  {space.phase === "pending" && (
                    <div className="mx-auto h-1.5 w-1.5 rounded-full bg-gray-300" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs",
                    isDone
                      ? "text-gray-600"
                      : isActive
                        ? "font-medium text-gray-800"
                        : "text-gray-400"
                  )}
                >
                  {space.name}
                </span>
                {detail && (
                  <span className="ml-auto font-mono text-[10px] text-gray-400">
                    {detail}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <PhaseRow
        label="Validating structure..."
        status={getStatus("critiquing")}
      />

      <PhaseRow
        label="Discovering connections..."
        status={getStatus("weaving")}
        detail={
          bridgeCount > 0
            ? `${bridgeCount} bridges · ${contradictionCount} contradictions`
            : undefined
        }
      />

      <PhaseRow
        label="Generating strategy..."
        status={getStatus("synthesizing")}
      />

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
