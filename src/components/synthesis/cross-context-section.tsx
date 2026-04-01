"use client";

import { SectionHeader } from "@/components/ui/section-header";
import { Ring } from "@/components/ui/ring";

interface CrossContextInsight {
  insight: string;
  internal_entities: string[];
  external_entities: string[];
  confidence: "high" | "moderate" | "low";
}

const confidenceValue: Record<string, number> = {
  high: 0.9,
  moderate: 0.65,
  low: 0.35,
};

export function CrossContextSection({
  insights,
}: {
  insights: CrossContextInsight[];
}) {
  if (insights.length === 0) return null;

  return (
    <section>
      <SectionHeader
        label="Cross-Context Insights"
        color="amber"
        subtitle="Connections between your analysis and field knowledge"
      />

      <div className="mt-3 space-y-3">
        {insights.map((insight, i) => (
          <div
            key={i}
            className="rounded-lg border border-amber-100 bg-amber-50/30 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="flex-1 text-[13px] leading-relaxed text-gray-700">
                {insight.insight}
              </p>
              <Ring
                value={confidenceValue[insight.confidence] ?? 0.5}
                size={36}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {insight.internal_entities.map((id) => (
                <span
                  key={id}
                  className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600"
                >
                  {id}
                </span>
              ))}
              <span className="text-[10px] text-gray-400">↔</span>
              {insight.external_entities.map((id) => (
                <span
                  key={id}
                  className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-600"
                >
                  {id}
                </span>
              ))}
            </div>

            <div className="mt-2 text-[10px] text-gray-400">
              Confidence: {insight.confidence} · Cross-domain analogy
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
