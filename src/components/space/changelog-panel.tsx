"use client";

import { useEffect, useState } from "react";
import { X, Sparkles, FileText, Loader2, GitFork, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { SpaceChangelog } from "@/types";

const changeTypeConfig: Record<
  string,
  { label: string; color: string; bg: string; icon: typeof Sparkles }
> = {
  initial_analysis: {
    label: "Initial analysis",
    color: "text-blue-600",
    bg: "bg-blue-50",
    icon: FileText,
  },
  reevaluation: {
    label: "Re-evaluation",
    color: "text-green-600",
    bg: "bg-green-50",
    icon: Sparkles,
  },
  manual_edit: {
    label: "Manual edit",
    color: "text-gray-600",
    bg: "bg-gray-50",
    icon: FileText,
  },
  exploration: {
    label: "Exploration",
    color: "text-purple-600",
    bg: "bg-purple-50",
    icon: GitFork,
  },
  synthesis_refresh: {
    label: "Synthesis refresh",
    color: "text-amber-600",
    bg: "bg-amber-50",
    icon: RefreshCw,
  },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ChangelogPanel({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<SpaceChangelog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("space_changelog")
        .select("*")
        .eq("space_id", spaceId)
        .order("created_at", { ascending: false })
        .limit(50);

      setEntries((data ?? []) as SpaceChangelog[]);
      setLoading(false);
    }
    load();
  }, [spaceId]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-gray-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold">History</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">
              No history yet. Changes will appear here after analyses and
              re-evaluations.
            </p>
          ) : (
            <div className="space-y-4">
              {entries.map((entry) => {
                const config =
                  changeTypeConfig[entry.change_type] ??
                  changeTypeConfig.manual_edit;
                const Icon = config.icon;
                const details = entry.details as Record<string, unknown>;

                return (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-gray-100 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-6 w-6 items-center justify-center rounded-md ${config.bg}`}
                        >
                          <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                        </div>
                        <span
                          className={`text-xs font-medium ${config.color}`}
                        >
                          {config.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400">
                        {timeAgo(entry.created_at)}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-gray-700">
                      {entry.summary}
                    </p>

                    {/* Details */}
                    {details && Object.keys(details).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {details.added_edges !== undefined &&
                          (details.added_edges as number) > 0 && (
                            <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                              +{String(details.added_edges)} edges
                            </span>
                          )}
                        {details.added_cycles !== undefined &&
                          (details.added_cycles as number) > 0 && (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                              +{String(details.added_cycles)} cycles
                            </span>
                          )}
                        {details.updated_entities !== undefined &&
                          (details.updated_entities as number) > 0 && (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                              {String(details.updated_entities)} updated
                            </span>
                          )}
                        {details.entity_count !== undefined && (
                          <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                            {String(details.entity_count)} entities
                          </span>
                        )}
                        {details.edge_count !== undefined && (
                          <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                            {String(details.edge_count)} edges
                          </span>
                        )}
                        {/* Synthesis-level change details */}
                        {details.health_delta !== undefined &&
                          (details.health_delta as number) !== 0 && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                (details.health_delta as number) > 0
                                  ? "bg-green-50 text-green-600"
                                  : "bg-red-50 text-red-600"
                              }`}
                            >
                              {(details.health_delta as number) > 0 ? "+" : ""}
                              {String(details.health_delta)} health
                            </span>
                          )}
                        {details.leverage_added !== undefined &&
                          (details.leverage_added as number) > 0 && (
                            <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                              +{String(details.leverage_added)} leverage
                            </span>
                          )}
                        {details.leverage_removed !== undefined &&
                          (details.leverage_removed as number) > 0 && (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                              -{String(details.leverage_removed)} leverage
                            </span>
                          )}
                        {details.risk_added !== undefined &&
                          (details.risk_added as number) > 0 && (
                            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                              +{String(details.risk_added)} risks
                            </span>
                          )}
                        {details.risk_removed !== undefined &&
                          (details.risk_removed as number) > 0 && (
                            <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                              -{String(details.risk_removed)} risks
                            </span>
                          )}
                        {details.bottleneck_changed === true && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                            bottleneck shifted
                          </span>
                        )}
                        {details.objectives_stale === true && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                            objectives stale
                          </span>
                        )}
                        {details.magnitude !== undefined && (
                          <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                            {String(details.magnitude)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
