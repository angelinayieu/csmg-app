"use client";

import { SectionHeader } from "@/components/ui/section-header";
import { CalloutBox } from "@/components/ui/callout-box";
import type { Entity } from "@/types";

const categoryConfig: Record<
  string,
  { label: string; icon: string; color: string; bg: string }
> = {
  competitor: { label: "Competitive Landscape", icon: "⚔", color: "text-red-600", bg: "bg-red-50" },
  framework: { label: "Relevant Framework", icon: "🧩", color: "text-purple-600", bg: "bg-purple-50" },
  pattern: { label: "Known Pattern", icon: "🔄", color: "text-blue-600", bg: "bg-blue-50" },
  data_point: { label: "Market Data", icon: "📊", color: "text-green-600", bg: "bg-green-50" },
  analogy: { label: "Cross-Domain Analogy", icon: "🔗", color: "text-amber-600", bg: "bg-amber-50" },
  risk_pattern: { label: "Known Risk", icon: "⚠", color: "text-red-600", bg: "bg-red-50" },
  resource: { label: "Resource", icon: "🔧", color: "text-teal-600", bg: "bg-teal-50" },
};

const authorityBadge: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: "Verified", color: "text-green-700", bg: "bg-green-50" },
  moderate: { label: "Likely accurate", color: "text-blue-700", bg: "bg-blue-50" },
  low: { label: "From training data", color: "text-gray-600", bg: "bg-gray-100" },
  unverified: { label: "Unverified", color: "text-amber-700", bg: "bg-amber-50" },
};

export function ExternalContextSection({
  externalEntities,
}: {
  externalEntities: Entity[];
}) {
  if (externalEntities.length === 0) return null;

  // Group by category from provenance
  const grouped = new Map<string, Entity[]>();
  for (const e of externalEntities) {
    const prov = e.provenance as Record<string, unknown> | null;
    const cat = (prov?.category as string) ?? "pattern";
    const list = grouped.get(cat) ?? [];
    list.push(e);
    grouped.set(cat, list);
  }

  return (
    <section>
      <SectionHeader
        label="External Context"
        color="purple"
        subtitle={`${externalEntities.length} external insights`}
      />
      <p className="mt-1 mb-4 text-xs text-gray-500">
        Field context from outside your immediate situation. Toggle external
        entities in Graph View to see them on the graph.
      </p>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([category, entities]) => {
          const config = categoryConfig[category] ?? categoryConfig.pattern;

          return (
            <div key={category}>
              <div className="mb-2 flex items-center gap-2">
                <span>{config.icon}</span>
                <span className={`text-xs font-semibold uppercase tracking-wider ${config.color}`}>
                  {config.label}
                </span>
              </div>

              <div className="space-y-2">
                {entities.map((entity) => {
                  const prov = entity.provenance as Record<string, unknown> | null;
                  const relevance = (prov?.relevance as string) ?? "";
                  const auth = authorityBadge[entity.authority_level] ?? authorityBadge.low;

                  return (
                    <div
                      key={entity.id}
                      className="rounded-lg border border-gray-100 bg-gray-50/50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-semibold text-gray-400">
                            {entity.entity_id}
                          </span>
                          <h4 className="text-sm font-medium text-gray-800">
                            {entity.name}
                          </h4>
                        </div>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${auth.color} ${auth.bg}`}
                        >
                          {auth.label}
                        </span>
                      </div>

                      {entity.description && (
                        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
                          {entity.description}
                        </p>
                      )}

                      {relevance && (
                        <CalloutBox type="insight" label="Why this matters">
                          {relevance}
                        </CalloutBox>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
