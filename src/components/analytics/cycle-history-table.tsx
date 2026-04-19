"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import type { LoopCycleRecordRow } from "@/types/loop-metrics";

interface CycleHistoryTableProps {
  cycles: LoopCycleRecordRow[];
  spaceNames: Map<string, string>;
}

const STATUS_CONFIG: Record<
  string,
  { icon: React.ReactNode; color: string; bg: string }
> = {
  completed: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  failed: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    color: "text-red-600",
    bg: "bg-red-50",
  },
  running: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  partial: {
    icon: <Clock className="h-3.5 w-3.5" />,
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
};

export function CycleHistoryTable({
  cycles,
  spaceNames,
}: CycleHistoryTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (cycles.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
      <div className="p-5 pb-3">
        <h3 className="text-[15px] font-semibold tracking-tight text-gray-900 mb-1">
          Research Cycle History
        </h3>
        <p className="text-xs text-gray-500">
          Past self-improving loop executions and their results
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-100 text-left text-[11px] font-medium uppercase tracking-wider text-gray-400">
              <th className="px-5 py-2">#</th>
              <th className="px-3 py-2">Space</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Trigger</th>
              <th className="px-3 py-2">Depth</th>
              <th className="px-3 py-2">+Entities</th>
              <th className="px-3 py-2">+Edges</th>
              <th className="px-3 py-2">Coverage \u0394</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {cycles.map((cycle) => {
              const config = STATUS_CONFIG[cycle.status] ?? STATUS_CONFIG.partial;
              const delta = cycle.delta as unknown as Record<string, number> | null;
              const isExpanded = expandedId === cycle.id;

              return (
                <React.Fragment key={cycle.id}>
                  <tr className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-5 py-2.5 font-mono text-xs text-gray-400">
                      {cycle.cycle_number}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-700 max-w-[120px] truncate">
                      {spaceNames.get(cycle.space_id) ?? cycle.space_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">
                      {new Date(cycle.started_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                        {cycle.trigger_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">
                      {cycle.depth_used}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-medium text-green-600">
                      {delta?.entities_added ? `+${delta.entities_added}` : "0"}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-medium text-blue-600">
                      {delta?.edges_added ? `+${delta.edges_added}` : "0"}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {delta?.coverage_before != null && delta?.coverage_after != null ? (
                        <span
                          className={cn(
                            "font-medium",
                            delta.coverage_after > delta.coverage_before
                              ? "text-green-600"
                              : delta.coverage_after < delta.coverage_before
                                ? "text-red-500"
                                : "text-gray-400"
                          )}
                        >
                          {delta.coverage_before}% \u2192 {delta.coverage_after}%
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          config.bg,
                          config.color
                        )}
                      >
                        {config.icon}
                        {cycle.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() =>
                          setExpandedId(isExpanded ? null : cycle.id)
                        }
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            isExpanded && "rotate-180"
                          )}
                        />
                      </button>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={10} className="bg-gray-50/50 px-5 py-3">
                        <div className="space-y-2">
                          {/* Phases */}
                          {Array.isArray(cycle.phases) &&
                            cycle.phases.length > 0 && (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                                  Phases
                                </div>
                                <div className="space-y-1">
                                  {cycle.phases.map((phase, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center justify-between text-xs"
                                    >
                                      <span className="text-gray-600">
                                        {phase.phase_name}
                                      </span>
                                      <span className="text-gray-400">
                                        {phase.duration_ms}ms —{" "}
                                        {phase.result_summary}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                          {/* Error */}
                          {cycle.error_message && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                              {cycle.error_message}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
