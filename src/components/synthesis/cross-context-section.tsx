"use client";

import { cn } from "@/lib/utils";
import { Ring } from "@/components/ui/ring";
import { InsightActions } from "@/components/ui/insight-actions";
import type { InsightStatus } from "@/types/synthesis";

interface CrossContextInsight {
  insight: string;
  internal_entities: string[];
  external_entities: string[];
  confidence: "high" | "moderate" | "low";
  authority_level?: "high" | "moderate" | "low" | "unverified";
}

const confidenceValue: Record<string, number> = {
  high: 0.9,
  moderate: 0.65,
  low: 0.35,
};

const authorityConfig: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: "Verified", color: "text-green-700", bg: "bg-green-50" },
  moderate: { label: "Likely accurate", color: "text-blue-700", bg: "bg-blue-50" },
  low: { label: "Training data", color: "text-gray-600", bg: "bg-gray-100" },
  unverified: { label: "Unverified", color: "text-amber-700", bg: "bg-amber-50" },
};

export function CrossContextSection({
  insights,
  insightStatuses,
  onInsightStatusChange,
}: {
  insights: CrossContextInsight[];
  insightStatuses?: Record<number, InsightStatus>;
  onInsightStatusChange?: (index: number, status: InsightStatus) => void;
}) {
  if (insights.length === 0) return null;

  return (
    <div>
      <div className="space-y-3">
        {insights.map((insight, i) => (
          <div
            key={i}
            className="rounded-lg border border-amber-100 bg-amber-50/30 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="flex-1 text-[15px] leading-relaxed text-gray-700">
                {insight.insight}
              </p>
              <Ring
                value={confidenceValue[insight.confidence] ?? 0.5}
                size={36}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {insight.internal_entities.map((id) => (
                <span
                  key={id}
                  className="rounded bg-blue-50 px-1.5 py-0.5 text-[12px] font-medium text-blue-600"
                >
                  {id}
                </span>
              ))}
              <span className="text-[12px] text-gray-400">&harr;</span>
              {insight.external_entities.map((id) => (
                <span
                  key={id}
                  className="rounded bg-purple-50 px-1.5 py-0.5 text-[12px] font-medium text-purple-600"
                >
                  {id}
                </span>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-medium",
                insight.confidence === "high" ? "bg-green-50 text-green-700" :
                insight.confidence === "moderate" ? "bg-amber-50 text-amber-700" :
                "bg-red-50 text-red-700"
              )}>
                {insight.confidence}
              </span>
              {insight.authority_level && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${authorityConfig[insight.authority_level]?.color ?? "text-gray-500"} ${authorityConfig[insight.authority_level]?.bg ?? "bg-gray-50"}`}
                >
                  {authorityConfig[insight.authority_level]?.label ?? insight.authority_level}
                </span>
              )}
            </div>

            {onInsightStatusChange && (
              <InsightActions
                status={insightStatuses?.[i] ?? null}
                onAccept={() => onInsightStatusChange(i, insightStatuses?.[i] === "accepted" ? null : "accepted")}
                onInvestigate={() => onInsightStatusChange(i, insightStatuses?.[i] === "investigating" ? null : "investigating")}
                onDismiss={() => onInsightStatusChange(i, insightStatuses?.[i] === "dismissed" ? null : "dismissed")}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
