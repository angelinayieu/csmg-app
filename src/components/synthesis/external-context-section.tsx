"use client";

import { Swords, Blocks, RefreshCw, BarChart3, Link, AlertTriangle, Wrench } from "lucide-react";
import { CalloutBox } from "@/components/ui/callout-box";
import type { Entity } from "@/types";

const categoryConfig: Record<
  string,
  { label: string; icon: React.ReactNode; color: string; bg: string }
> = {
  competitor: { label: "Competition", icon: <Swords className="h-3.5 w-3.5" />, color: "text-red-600", bg: "bg-red-50" },
  framework: { label: "Framework", icon: <Blocks className="h-3.5 w-3.5" />, color: "text-purple-600", bg: "bg-purple-50" },
  pattern: { label: "Known Pattern", icon: <RefreshCw className="h-3.5 w-3.5" />, color: "text-blue-600", bg: "bg-blue-50" },
  data_point: { label: "Market Data", icon: <BarChart3 className="h-3.5 w-3.5" />, color: "text-green-600", bg: "bg-green-50" },
  analogy: { label: "Analogy", icon: <Link className="h-3.5 w-3.5" />, color: "text-amber-600", bg: "bg-amber-50" },
  risk_pattern: { label: "Known Risk", icon: <AlertTriangle className="h-3.5 w-3.5" />, color: "text-red-600", bg: "bg-red-50" },
  resource: { label: "Resource", icon: <Wrench className="h-3.5 w-3.5" />, color: "text-teal-600", bg: "bg-teal-50" },
};

function getAuthorityBadge(
  authorityLevel: string,
  sourceType: string | undefined
): { label: string; color: string; bg: string } {
  // Web-sourced entities get a distinct badge
  if (sourceType === "web_search") {
    return { label: "Web-verified", color: "text-green-700", bg: "bg-green-50" };
  }
  const badges: Record<string, { label: string; color: string; bg: string }> = {
    high: { label: "Verified", color: "text-green-700", bg: "bg-green-50" },
    moderate: { label: "Likely accurate", color: "text-blue-700", bg: "bg-blue-50" },
    low: { label: "Training data", color: "text-gray-600", bg: "bg-gray-100" },
    unverified: { label: "Unverified", color: "text-amber-700", bg: "bg-amber-50" },
  };
  return badges[authorityLevel] ?? badges.low;
}

/** Extract all unique source URLs from an entity's provenance. */
function getSourceUrls(prov: Record<string, unknown> | null): string[] {
  if (!prov) return [];
  const urls: string[] = [];

  // Primary source URL
  if (typeof prov.source_url === "string" && prov.source_url) {
    urls.push(prov.source_url);
  }

  // Citation URLs from Anthropic's web search
  if (Array.isArray(prov.citation_urls)) {
    for (const u of prov.citation_urls) {
      if (typeof u === "string" && u && !urls.includes(u)) {
        urls.push(u);
      }
    }
  }

  return urls;
}

/** Try to extract a readable domain from a URL. */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "source";
  }
}

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
    <div>
      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([category, entities]) => {
          const config = categoryConfig[category] ?? categoryConfig.pattern;

          return (
            <div key={category}>
              <div className="mb-2 flex items-center gap-2">
                <span>{config.icon}</span>
                <span className={`text-[13px] font-semibold ${config.color}`}>
                  {config.label}
                </span>
              </div>

              <div className="space-y-2">
                {entities.map((entity) => {
                  const prov = entity.provenance as Record<string, unknown> | null;
                  const relevance = (prov?.relevance as string) ?? "";
                  const sourceType = prov?.source_type as string | undefined;
                  const sourceDetail = prov?.source_detail as string | undefined;
                  const auth = getAuthorityBadge(entity.authority_level, sourceType);
                  const sourceUrls = getSourceUrls(prov);

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
                        <p className="mt-1.5 text-[14px] leading-relaxed text-gray-600">
                          {entity.description}
                        </p>
                      )}

                      {/* Source links — shown for web-verified entities */}
                      {sourceUrls.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {sourceUrls.slice(0, 3).map((url, j) => (
                            <a
                              key={j}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-100 transition-colors"
                            >
                              <span className="text-[9px]">↗</span>
                              <span>{getDomain(url)}</span>
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Source detail — human-readable provenance note */}
                      {sourceDetail && !sourceUrls.length && (
                        <p className="mt-1 text-[10px] italic text-gray-400">
                          Source: {sourceDetail}
                        </p>
                      )}

                      {relevance && (
                        <CalloutBox type="insight" label="Relevance">
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
    </div>
  );
}
