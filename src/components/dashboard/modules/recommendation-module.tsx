"use client";

import { useEffect, useState } from "react";
import { Lightbulb, ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import type { GoalRecommendation } from "@/types/goals";

interface RecommendationModuleProps {
  goalId: string;
}

const impactColors: Record<string, { bg: string; text: string }> = {
  high: { bg: "bg-green-50", text: "text-green-700" },
  medium: { bg: "bg-amber-50", text: "text-amber-700" },
  low: { bg: "bg-gray-50", text: "text-gray-500" },
};

export function RecommendationModule({ goalId }: RecommendationModuleProps) {
  const [recommendations, setRecommendations] = useState<GoalRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/goals/${goalId}/recommendations`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setRecommendations(data.recommendations ?? []);
        }
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [goalId]);

  const top = recommendations[0];
  const rest = recommendations.slice(1);

  return (
    <DashboardCard
      title="Top Recommendations"
      icon={<Lightbulb className="h-4 w-4" />}
      subtitle={recommendations.length > 0 ? `${recommendations.length} ranked` : undefined}
      collapsible={false}
    >
      {loading && (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Loading recommendations...
        </div>
      )}

      {!loading && recommendations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Lightbulb className="h-6 w-6 text-gray-300 mb-2" />
          <p className="text-xs text-gray-400">
            Run analysis to generate goal-aligned recommendations.
          </p>
        </div>
      )}

      {!loading && top && (
        <div className="space-y-3">
          {/* Top recommendation — highlighted */}
          <div className="rounded-lg border border-interaxis-200 bg-interaxis-50/50 p-3">
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-interaxis-500 text-[10px] font-bold text-white flex-shrink-0">
                1
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{top.title}</p>
                <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                  {top.reasoning}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  {top.impact_estimate && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        impactColors[top.impact_estimate]?.bg ?? "bg-gray-50",
                        impactColors[top.impact_estimate]?.text ?? "text-gray-500"
                      )}
                    >
                      {top.impact_estimate} impact
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">
                    {top.source_type.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* View all toggle */}
          {rest.length > 0 && (
            <>
              <button
                onClick={() => setShowAll(!showAll)}
                className="flex w-full items-center justify-center gap-1 text-xs font-medium text-interaxis-600 hover:text-interaxis-700 transition-colors"
              >
                {showAll ? "Hide" : `View all ${recommendations.length}`}
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showAll && "rotate-180"
                  )}
                />
              </button>

              {showAll && (
                <div className="space-y-2">
                  {rest.map((rec) => (
                    <div
                      key={rec.id}
                      className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2"
                    >
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[9px] font-bold text-gray-500 flex-shrink-0 mt-0.5">
                        {rec.rank}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700">
                          {rec.title}
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-500 line-clamp-2">
                          {rec.reasoning}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          {rec.impact_estimate && (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                                impactColors[rec.impact_estimate]?.bg ?? "bg-gray-50",
                                impactColors[rec.impact_estimate]?.text ?? "text-gray-500"
                              )}
                            >
                              {rec.impact_estimate}
                            </span>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="h-3 w-3 text-gray-300 flex-shrink-0 mt-1" />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
