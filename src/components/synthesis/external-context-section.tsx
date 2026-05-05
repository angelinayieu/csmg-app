"use client";

import { useState } from "react";
import {
  Swords,
  Blocks,
  RefreshCw,
  BarChart3,
  Link,
  AlertTriangle,
  Wrench,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { CalloutBox } from "@/components/ui/callout-box";
import type { Entity, Bridge } from "@/types";

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
): { label: string; color: string; bg: string } | null {
  if (sourceType === "web_search") {
    return { label: "Web-verified", color: "text-green-700", bg: "bg-green-50" };
  }
  if (authorityLevel === "high") {
    return { label: "Verified", color: "text-green-700", bg: "bg-green-50" };
  }
  if (authorityLevel === "moderate") {
    return { label: "Likely accurate", color: "text-blue-700", bg: "bg-blue-50" };
  }
  // Suppress "Unverified" / "Training data" — they're noise that conditions
  // the reader to distrust the panel. Absence of badge = the entity comes
  // from the LLM's training corpus without web corroboration, which is the
  // default state for most field context. Adding a noisy amber chip on
  // every card doesn't add information; it just dilutes the badges that
  // do mean something.
  return null;
}

function getSourceUrls(prov: Record<string, unknown> | null): string[] {
  if (!prov) return [];
  const urls: string[] = [];
  if (typeof prov.source_url === "string" && prov.source_url) {
    urls.push(prov.source_url);
  }
  if (Array.isArray(prov.citation_urls)) {
    for (const u of prov.citation_urls) {
      if (typeof u === "string" && u && !urls.includes(u)) {
        urls.push(u);
      }
    }
  }
  return urls;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "source";
  }
}

const SUB_PATTERN = /^SUB2?_x(\d+)_/;

function isSubComponent(entityId: string): boolean {
  return SUB_PATTERN.test(entityId);
}

function getRootKey(entityId: string): string | null {
  const match = entityId.match(SUB_PATTERN);
  return match ? `X${match[1]}` : null;
}

function isLeafSub(entityId: string): boolean {
  return entityId.startsWith("SUB2_");
}

// Boilerplate descriptions the materializer auto-generates have the
// shape "Sub-component of X: Fundamental unit of X" — pure filler. We
// drop them so the card has either a real description or none, instead
// of a tautology that adds no signal.
function isBoilerplateDescription(name: string, description: string | null | undefined): boolean {
  if (!description) return true;
  const d = description.trim();
  if (!d) return true;
  if (/^Fundamental unit of /i.test(d)) return true;
  if (/^Sub-component of .+:\s*Fundamental unit of /i.test(d)) return true;
  // "Sub-component of X" with no further detail is also filler.
  if (/^Sub-component of [^:]+\.?$/i.test(d)) return true;
  return false;
}

function cleanDescription(name: string, description: string | null | undefined): string | null {
  if (isBoilerplateDescription(name, description)) return null;
  return (description ?? "").trim() || null;
}

export function ExternalContextSection({
  externalEntities,
  bridges = [],
}: {
  externalEntities: Entity[];
  bridges?: Bridge[];
}) {
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const [showObservatory, setShowObservatory] = useState(false);

  if (externalEntities.length === 0) return null;

  // Build the set of external entities that bridge to an internal entity
  // — these are "embedded" intelligence the strategy actively uses, not
  // observatory background context.
  const embeddedEntityIds = new Set<string>();
  for (const b of bridges) {
    embeddedEntityIds.add(b.source_entity_id);
    embeddedEntityIds.add(b.target_entity_id);
  }

  // Partition into roots vs sub-component children, indexed by their X-parent.
  const allRoots: Entity[] = [];
  const childrenByRoot = new Map<string, Entity[]>();
  for (const e of externalEntities) {
    if (isSubComponent(e.entity_id)) {
      const rootKey = getRootKey(e.entity_id);
      if (rootKey) {
        const list = childrenByRoot.get(rootKey) ?? [];
        list.push(e);
        childrenByRoot.set(rootKey, list);
        continue;
      }
    }
    allRoots.push(e);
  }

  // Order children: SUB_ before SUB2_ so the immediate level shows first when expanded.
  for (const list of childrenByRoot.values()) {
    list.sort((a, b) => {
      const aLeaf = isLeafSub(a.entity_id);
      const bLeaf = isLeafSub(b.entity_id);
      if (aLeaf !== bLeaf) return aLeaf ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }

  // Embedded vs observatory split. A root counts as embedded if it OR
  // any of its sub-components has a bridge edge to an internal entity.
  const embeddedRoots: Entity[] = [];
  const observatoryRoots: Entity[] = [];
  for (const root of allRoots) {
    const childIds = (childrenByRoot.get(root.entity_id) ?? []).map((c) => c.id);
    const isEmbedded =
      embeddedEntityIds.has(root.id) ||
      childIds.some((id) => embeddedEntityIds.has(id));
    if (isEmbedded) embeddedRoots.push(root);
    else observatoryRoots.push(root);
  }

  // If the bridge data is missing entirely (older runs, no Phase 4
  // bridge analysis) we have no way to distinguish. Fall back to "all
  // visible by default" so we don't accidentally hide everything.
  const hasBridgeSignal = bridges.length > 0 && embeddedRoots.length > 0;
  const visibleRoots = hasBridgeSignal
    ? showObservatory
      ? [...embeddedRoots, ...observatoryRoots]
      : embeddedRoots
    : allRoots;

  // Group visible roots by their provenance category (existing behavior).
  const grouped = new Map<string, Entity[]>();
  for (const e of visibleRoots) {
    const prov = e.provenance as Record<string, unknown> | null;
    const cat = (prov?.category as string) ?? "pattern";
    const list = grouped.get(cat) ?? [];
    list.push(e);
    grouped.set(cat, list);
  }

  const toggleRoot = (id: string) => {
    setExpandedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
                  const cleanDesc = cleanDescription(entity.name, entity.description);

                  const children = childrenByRoot.get(entity.entity_id) ?? [];
                  const hasChildren = children.length > 0;
                  const isExpanded = expandedRoots.has(entity.entity_id);
                  const isEmbedded = embeddedEntityIds.has(entity.id);

                  return (
                    <div
                      key={entity.id}
                      className="rounded-lg border border-gray-100 bg-gray-50/50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-medium text-gray-800">
                            {entity.name}
                          </h4>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isEmbedded && (
                            <span
                              className="rounded bg-purple-50 px-1.5 py-0.5 text-[9px] font-semibold text-purple-700"
                              title="Bridges to your situation — actively shaping the strategy"
                            >
                              Bridged
                            </span>
                          )}
                          {auth && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${auth.color} ${auth.bg}`}
                            >
                              {auth.label}
                            </span>
                          )}
                        </div>
                      </div>

                      {cleanDesc && (
                        <p className="mt-1.5 text-[14px] leading-relaxed text-gray-600">
                          {cleanDesc}
                        </p>
                      )}

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

                      {hasChildren && (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleRoot(entity.entity_id)}
                            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 transition-colors hover:text-gray-700"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            <span>
                              {isExpanded ? "Hide" : "Show"} {children.length} sub-component
                              {children.length === 1 ? "" : "s"}
                            </span>
                          </button>

                          {isExpanded && (
                            <div className="mt-2 ml-1 space-y-1.5 border-l-2 border-gray-200 pl-3">
                              {children.map((child) => {
                                const childProv = child.provenance as
                                  | Record<string, unknown>
                                  | null;
                                const childSourceType = childProv?.source_type as
                                  | string
                                  | undefined;
                                const childAuth = getAuthorityBadge(
                                  child.authority_level,
                                  childSourceType
                                );
                                const isLeaf = isLeafSub(child.entity_id);
                                const childDesc = cleanDescription(child.name, child.description);

                                return (
                                  <div
                                    key={child.id}
                                    className={`flex items-start gap-2 ${isLeaf ? "ml-3" : ""}`}
                                  >
                                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[12px] font-medium text-gray-700">
                                          {child.name}
                                        </span>
                                        {childAuth && (
                                          <span
                                            className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-medium ${childAuth.color} ${childAuth.bg}`}
                                          >
                                            {childAuth.label}
                                          </span>
                                        )}
                                      </div>
                                      {childDesc && (
                                        <p className="text-[11px] leading-snug text-gray-500">
                                          {childDesc}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {hasBridgeSignal && observatoryRoots.length > 0 && (
        <button
          type="button"
          onClick={() => setShowObservatory((s) => !s)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors"
        >
          {showObservatory ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span>
            {showObservatory ? "Hide" : "Show"} {observatoryRoots.length} observatory item
            {observatoryRoots.length === 1 ? "" : "s"}
          </span>
          <span className="ml-1 text-[10px] text-gray-400">
            (field context, not bridged to your situation)
          </span>
        </button>
      )}
    </div>
  );
}
