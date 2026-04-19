"use client";

import React, { useState, useMemo } from "react";
import {
  X,
  ExternalLink,
  ArrowRight,
  ArrowLeft,
  Globe,
  Link2,
  Lightbulb,
  Shield,
  Radio,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity, Edge } from "@/types";
import type {
  ConnectionAnalysis,
  EpistemicNodeType,
  SourceCredibility,
  AuthorityLevel,
  IntelligenceSignal,
  SignalStatus,
} from "@/types/intelligence";
import { AUTHORITY_CONFIG } from "@/types/intelligence";
import type { CrossContextInsight, Axiom, InsightConvergence, AssumptionInversion, SynthesisData } from "@/types/synthesis";
import { EPISTEMIC_CONFIG } from "./graph-filter-rail";
import { cleanEntityName } from "./orbital-graph";

// ── Types ──

type InspectorTab = "sources" | "connections" | "reasoning" | "insights" | "provenance" | "signals";

interface EntityInspectorProps {
  entityId: string | null;
  entities: Entity[];
  edges: Edge[];
  credibilityMap: Map<string, SourceCredibility>;
  epistemicTypeMap: Map<string, EpistemicNodeType>;
  connectionAnalysis: (entityId: string) => ConnectionAnalysis | null;
  crossContextInsights: CrossContextInsight[];
  signals: IntelligenceSignal[];
  /** Reasoning-layer data — optional; enables the Reasoning tab with axiom + convergence + inversion backlinks */
  axioms?: Axiom[];
  insightConvergences?: InsightConvergence[];
  assumptionInversions?: AssumptionInversion[];
  expansionAxioms?: NonNullable<SynthesisData["expansion_axioms"]>;
  onClose: () => void;
  onNavigate: (entityId: string) => void;
  onAuthorityChange: (entityDbId: string, level: AuthorityLevel) => Promise<void>;
  onSignalAction: (signalId: string, status: SignalStatus) => void;
}

// ── Helpers ──

function faviconLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    if (host.includes("arxiv")) return "arX";
    if (host.includes("mit.edu")) return "MIT";
    if (host.includes("hbr.org")) return "HBR";
    if (host.includes(".gov")) return "Gov";
    if (host.includes("nature.com")) return "Nat";
    if (host.includes("science")) return "Sci";
    return host.split(".")[0].slice(0, 3).toUpperCase();
  } catch {
    return "SRC";
  }
}

const AUTHORITY_LEVELS: AuthorityLevel[] = ["high", "moderate", "low", "unverified"];

const TAB_CONFIG: Array<{ key: InspectorTab; label: string; icon: React.ReactNode }> = [
  { key: "sources", label: "Sources", icon: <Globe className="h-3 w-3" /> },
  { key: "connections", label: "Connections", icon: <Link2 className="h-3 w-3" /> },
  { key: "reasoning", label: "Reasoning", icon: <Sparkles className="h-3 w-3" /> },
  { key: "insights", label: "Insights", icon: <Lightbulb className="h-3 w-3" /> },
  { key: "provenance", label: "Provenance", icon: <Shield className="h-3 w-3" /> },
  { key: "signals", label: "Signals", icon: <Radio className="h-3 w-3" /> },
];

// ── Component ──

export function EntityInspector({
  entityId,
  entities,
  edges,
  credibilityMap,
  epistemicTypeMap,
  connectionAnalysis,
  crossContextInsights,
  signals,
  axioms,
  insightConvergences,
  assumptionInversions,
  expansionAxioms,
  onClose,
  onNavigate,
  onAuthorityChange,
  onSignalAction,
}: EntityInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("sources");
  const [navStack, setNavStack] = useState<string[]>([]);

  const entity = useMemo(
    () => entities.find((e) => e.entity_id === entityId),
    [entities, entityId]
  );

  const entityEdges = useMemo(() => {
    if (!entityId) return [];
    return edges.filter(
      (e) => e.source_entity_id === entityId || e.target_entity_id === entityId ||
             e.source_entity_id === entity?.id || e.target_entity_id === entity?.id
    );
  }, [edges, entityId, entity]);

  const connAnalysis = useMemo(
    () => (entityId ? connectionAnalysis(entityId) : null),
    [entityId, connectionAnalysis]
  );

  const entitySignals = useMemo(
    () => signals.filter((s) => s.entity_id === entityId),
    [signals, entityId]
  );

  const entityInsights = useMemo(
    () => crossContextInsights.filter(
      (i) => i.external_entities?.includes(entityId ?? "") || i.internal_entities?.includes(entityId ?? "")
    ),
    [crossContextInsights, entityId]
  );

  // ── Reasoning-layer backlinks ──
  // An entity participates in reasoning when: axioms rest on it, it appears in a
  // convergence cluster's shared entities or signals, an inversion targets it,
  // or it was expanded (has mini-axioms keyed to it).
  const entityAxioms = useMemo(() => {
    if (!axioms || !entityId) return [];
    return axioms.filter((a) =>
      a.rests_on.includes(entityId) ||
      (a.scope_anchor ?? "").includes(entityId)
    );
  }, [axioms, entityId]);

  const entityConvergences = useMemo(() => {
    if (!insightConvergences || !entityId) return [];
    return insightConvergences.filter((c) =>
      c.shared_entity_ids.includes(entityId) ||
      c.signals.some((s) => s.entity_ids.includes(entityId))
    );
  }, [insightConvergences, entityId]);

  const entityInversions = useMemo(() => {
    if (!assumptionInversions || !entityId) return [];
    return assumptionInversions.filter((inv) => inv.target_entity_id === entityId);
  }, [assumptionInversions, entityId]);

  const entityExpansionAxioms = useMemo(() => {
    if (!expansionAxioms || !entity) return [];
    // expansion_axioms key by parent UUID (entity.id), not display entity_id
    return expansionAxioms.filter((a) => a.parent_entity_id === entity.id);
  }, [expansionAxioms, entity]);

  const reasoningCount =
    entityAxioms.length +
    entityConvergences.length +
    entityInversions.length +
    entityExpansionAxioms.length;

  const cred = entityId ? credibilityMap.get(entityId) : null;
  const epistemicType = entityId ? epistemicTypeMap.get(entityId) : null;

  const handleNavigate = (targetId: string) => {
    if (entityId) setNavStack((prev) => [...prev, entityId]);
    onNavigate(targetId);
  };

  const handleBack = () => {
    const prev = navStack[navStack.length - 1];
    if (prev) {
      setNavStack((s) => s.slice(0, -1));
      onNavigate(prev);
    }
  };

  // ── Empty state ──

  if (!entity || !entityId) {
    return (
      <div className="w-64 flex-shrink-0 rounded-lg border border-gray-200 bg-white flex items-center justify-center p-6">
        <div className="text-center">
          <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <Link2 className="h-5 w-5 text-gray-300" />
          </div>
          <p className="text-[12px] text-gray-400 leading-relaxed">
            Select a node in the graph to inspect its sources, connections, and insights.
          </p>
        </div>
      </div>
    );
  }

  const prov = entity.provenance as Record<string, unknown> | null;
  const citationUrls = (prov?.citation_urls as string[]) ?? [];
  const sourceUrl = prov?.source_url as string | undefined;
  const allUrls = [...new Set([...(sourceUrl ? [sourceUrl] : []), ...citationUrls])];

  // ── Entity lookup for connections ──
  const entityLookup = new Map<string, Entity>();
  for (const e of entities) {
    entityLookup.set(e.entity_id, e);
    entityLookup.set(e.id, e);
  }

  return (
    <div className="w-64 flex-shrink-0 rounded-lg border border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            {navStack.length > 0 && (
              <button onClick={handleBack} className="p-0.5 rounded hover:bg-gray-100 text-gray-400 flex-shrink-0">
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            )}
            {epistemicType && (
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0",
                EPISTEMIC_CONFIG[epistemicType].bg,
                EPISTEMIC_CONFIG[epistemicType].color
              )}>
                {EPISTEMIC_CONFIG[epistemicType].label}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-gray-100 text-gray-400 flex-shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <h3 className="text-[14px] font-semibold text-gray-800 mt-1 truncate">
          {cleanEntityName(entity)}
        </h3>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
          {cred && (
            <span className="tabular-nums">Cred: {cred.effective_confidence.toFixed(2)}</span>
          )}
          <span>{entityEdges.length} connections</span>
          <span>{allUrls.length} sources</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-1 flex-shrink-0">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.key
                ? "text-interaxis-600 border-interaxis-500"
                : "text-gray-400 border-transparent hover:text-gray-600"
            )}
          >
            {tab.icon}
            <span className="hidden xl:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* ── Sources tab ── */}
        {activeTab === "sources" && (
          <>
            {allUrls.length === 0 ? (
              <p className="text-[11px] text-gray-400 italic">No sources linked to this entity.</p>
            ) : (
              allUrls.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md border border-gray-100 px-2.5 py-2 hover:border-gray-200 hover:bg-gray-50 transition-colors group"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-gray-100 text-[8px] font-bold text-gray-500 flex-shrink-0">
                    {faviconLabel(url)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-gray-700 truncate">{url}</p>
                    {cred && (
                      <div className="mt-0.5 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-400"
                          style={{ width: `${cred.source_authority * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <ExternalLink className="h-3 w-3 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
                </a>
              ))
            )}
          </>
        )}

        {/* ── Connections tab ── */}
        {activeTab === "connections" && (
          <>
            {connAnalysis?.connections && connAnalysis.connections.length > 0 ? (
              <>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Direct ({connAnalysis.connections.length})
                </p>
                {connAnalysis.connections.map((conn, i) => (
                  <button
                    key={i}
                    onClick={() => handleNavigate(conn.internal_entity_id)}
                    className="flex items-center gap-2 w-full rounded-md border border-gray-100 px-2.5 py-2 hover:border-gray-200 hover:bg-gray-50 transition-colors text-left"
                  >
                    <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-700 truncate">{conn.internal_entity_name}</p>
                      <p className="text-[10px] text-gray-400 truncate">{conn.reasoning}</p>
                    </div>
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[8px] font-medium flex-shrink-0",
                      conn.type === "supports_leverage" ? "bg-blue-50 text-blue-600" :
                      conn.type === "validates_risk" ? "bg-red-50 text-red-600" :
                      conn.type === "challenges" ? "bg-amber-50 text-amber-600" :
                      "bg-gray-50 text-gray-500"
                    )}>
                      {conn.type.replace(/_/g, " ")}
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <p className="text-[11px] text-gray-400 italic">No connections analyzed yet.</p>
            )}

            {connAnalysis?.strategy_links && connAnalysis.strategy_links.length > 0 && (
              <>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mt-3 mb-1">
                  Strategy Links
                </p>
                {connAnalysis.strategy_links.map((link, i) => (
                  <div key={i} className="rounded-md border border-gray-100 px-2.5 py-2">
                    <p className="text-[11px] font-medium text-gray-700">
                      {link.tactic_title ?? link.perspective_name ?? link.infrastructure_component ?? "Strategy"}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{link.relevance}</p>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── Reasoning tab — axiom / convergence / inversion / expansion backlinks ── */}
        {activeTab === "reasoning" && (
          <>
            {reasoningCount === 0 ? (
              <p className="text-[11px] text-gray-400 italic">This entity isn&apos;t yet referenced by any axiom, convergence cluster, inversion, or expansion. Run a synthesis to surface reasoning backlinks.</p>
            ) : (
              <div className="space-y-4">
                {/* Axioms this entity grounds */}
                {entityAxioms.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-purple-600">
                        Grounds {entityAxioms.length} axiom{entityAxioms.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {entityAxioms.map((ax) => {
                        const visCls = ax.visibility === "HIDDEN"
                          ? "bg-red-50 text-red-700 ring-red-200"
                          : ax.visibility === "IMPLICIT"
                            ? "bg-amber-50 text-amber-700 ring-amber-200"
                            : "bg-gray-50 text-gray-600 ring-gray-200";
                        return (
                          <div key={ax.axiom_id} className="rounded-lg bg-purple-50/40 ring-1 ring-purple-100 px-2.5 py-2">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="font-mono text-[9px] text-purple-700 tabular-nums">{ax.axiom_id}</span>
                              <span className={cn("rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-medium", visCls)}>
                                {ax.visibility.charAt(0) + ax.visibility.slice(1).toLowerCase()}
                              </span>
                              <span className="text-[9px] text-gray-500">{ax.load_bearing}</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-gray-800">{ax.claim}</p>
                            {ax.if_false && (
                              <p className="mt-1 text-[10px] italic text-red-700/75 leading-snug">
                                If false: {ax.if_false}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Convergence clusters this entity participates in */}
                {entityConvergences.length > 0 && (
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-indigo-600 mb-1.5">
                      Participates in {entityConvergences.length} converging cluster{entityConvergences.length === 1 ? "" : "s"}
                    </div>
                    <div className="space-y-1.5">
                      {entityConvergences.map((c) => {
                        const strengthCls = c.strength === "strong"
                          ? "bg-indigo-600 text-white"
                          : c.strength === "moderate"
                            ? "bg-indigo-400 text-white"
                            : "bg-gray-300 text-gray-700";
                        return (
                          <div key={c.cluster_id} className="rounded-lg bg-indigo-50/40 ring-1 ring-indigo-100 px-2.5 py-2">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                              <span className={cn("rounded-full px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide", strengthCls)}>
                                {c.strength}
                              </span>
                              <span className="text-[9px] text-indigo-700 tabular-nums">
                                {c.signal_count} signals · {c.distinct_type_count} types
                              </span>
                              {c.has_hidden_axiom && (
                                <span className="rounded-full bg-red-50 ring-1 ring-red-200 px-1.5 py-[1px] text-[9px] font-semibold text-red-700">
                                  hidden axiom
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-medium text-gray-800 leading-snug">{c.concern_label}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Inversions targeting this entity */}
                {entityInversions.length > 0 && (
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-pink-600 mb-1.5">
                      Challenged by {entityInversions.length} inversion{entityInversions.length === 1 ? "" : "s"}
                    </div>
                    <div className="space-y-1.5">
                      {entityInversions.map((inv, i) => {
                        const plausCls = inv.plausibility === "more_likely_than_stated"
                          ? "bg-red-100 text-red-700"
                          : inv.plausibility === "coin_flip"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600";
                        return (
                          <div key={i} className="rounded-lg bg-pink-50/40 ring-1 ring-pink-100 px-2.5 py-2">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                              <span className={cn("rounded-full px-1.5 py-[1px] text-[9px] font-medium", plausCls)}>
                                {inv.plausibility.replace(/_/g, " ")}
                              </span>
                              <span className="text-[9px] text-gray-500">vs {inv.target_type.replace(/_/g, " ")}</span>
                              {inv.source === "auto_from_research" && (
                                <span className="rounded bg-emerald-50 ring-1 ring-emerald-200 px-1 py-[1px] text-[8px] text-emerald-700">auto</span>
                              )}
                            </div>
                            <p className="text-[11px] font-medium text-gray-800 leading-snug">{inv.inverted_claim}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Expansion axioms (if this entity was expanded) */}
                {entityExpansionAxioms.length > 0 && (
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-sky-600 mb-1.5">
                      {entityExpansionAxioms.length} expansion axiom{entityExpansionAxioms.length === 1 ? "" : "s"}
                    </div>
                    <div className="space-y-1.5">
                      {entityExpansionAxioms.map((ax, i) => {
                        const visCls = ax.visibility === "HIDDEN"
                          ? "bg-red-50 text-red-700 ring-red-200"
                          : ax.visibility === "IMPLICIT"
                            ? "bg-amber-50 text-amber-700 ring-amber-200"
                            : "bg-gray-50 text-gray-600 ring-gray-200";
                        return (
                          <div key={i} className="rounded-lg bg-sky-50/40 ring-1 ring-sky-100 px-2.5 py-2">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={cn("rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-medium", visCls)}>
                                {ax.visibility.charAt(0) + ax.visibility.slice(1).toLowerCase()}
                              </span>
                              <span className="text-[9px] text-gray-500">{ax.load_bearing}</span>
                            </div>
                            <p className="text-[11px] leading-snug text-gray-800">{ax.claim}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Insights tab ── */}
        {activeTab === "insights" && (
          <>
            {entityInsights.length === 0 ? (
              <p className="text-[11px] text-gray-400 italic">No insights reference this entity.</p>
            ) : (
              entityInsights.map((insight, i) => (
                <div key={i} className="rounded-md border border-gray-100 px-2.5 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[8px] font-bold uppercase",
                      insight.confidence === "high" ? "bg-green-50 text-green-600" :
                      insight.confidence === "moderate" ? "bg-blue-50 text-blue-600" :
                      "bg-gray-50 text-gray-500"
                    )}>
                      FINDING
                    </span>
                    <span className="text-[10px] text-gray-400">{insight.confidence}</span>
                  </div>
                  <p className="text-[11px] text-gray-700 leading-relaxed">{insight.insight}</p>
                  {insight.internal_entities.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {insight.internal_entities.slice(0, 4).map((eid) => {
                        const linkedEntity = entityLookup.get(eid);
                        return (
                          <button
                            key={eid}
                            onClick={() => handleNavigate(eid)}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                          >
                            {linkedEntity ? cleanEntityName(linkedEntity) : eid}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {/* ── Provenance tab ── */}
        {activeTab === "provenance" && (
          <>
            {/* Authority level buttons */}
            <div className="space-y-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Authority Level</p>
              <div className="grid grid-cols-2 gap-1">
                {AUTHORITY_LEVELS.map((level) => {
                  const cfg = AUTHORITY_CONFIG[level];
                  const isActive = entity.authority_level === level;
                  return (
                    <button
                      key={level}
                      onClick={() => onAuthorityChange(entity.id, level)}
                      className={cn(
                        "rounded-md px-2 py-1.5 text-[10px] font-medium border transition-all",
                        isActive
                          ? `${cfg.bg} ${cfg.color} border-current`
                          : "text-gray-400 border-gray-100 hover:border-gray-200"
                      )}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Intelligence tier */}
            <div className="mt-3 space-y-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Intel Tier</p>
              <span className={cn(
                "inline-block px-2 py-1 rounded text-[10px] font-medium",
                prov?.intelligence_tier === "embedded"
                  ? "bg-blue-50 text-blue-600"
                  : "bg-gray-100 text-gray-500"
              )}>
                {(prov?.intelligence_tier as string) ?? "observatory"}
              </span>
            </div>

            {/* Confidence & relevance bars */}
            <div className="mt-3 space-y-2">
              <div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-400">Confidence</span>
                  <span className="text-gray-600 tabular-nums">{(entity.confidence ?? 0).toFixed(2)}</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-400" style={{ width: `${(entity.confidence ?? 0) * 100}%` }} />
                </div>
              </div>
              {cred && (
                <div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-gray-400">Credibility</span>
                    <span className="text-gray-600 tabular-nums">{cred.effective_confidence.toFixed(2)}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-green-400" style={{ width: `${cred.effective_confidence * 100}%` }} />
                  </div>
                </div>
              )}
            </div>

            {/* Source details */}
            {prov?.source_detail && (
              <div className="mt-3">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Source Detail</p>
                <p className="text-[11px] text-gray-600 leading-relaxed">{prov.source_detail as string}</p>
              </div>
            )}

            {/* Temporal freshness */}
            {prov?.temporal_freshness && (
              <div className="mt-2">
                <span className="text-[10px] text-gray-400">Freshness: </span>
                <span className={cn(
                  "text-[10px] font-medium",
                  prov.temporal_freshness === "current" ? "text-green-600" :
                  prov.temporal_freshness === "recent" ? "text-blue-600" :
                  "text-gray-500"
                )}>
                  {prov.temporal_freshness as string}
                </span>
              </div>
            )}

            {/* Risk flags */}
            {(prov?.risk_signal_flags as string[] | undefined)?.length ? (
              <div className="mt-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Risk Flags</p>
                <div className="flex flex-wrap gap-1">
                  {(prov!.risk_signal_flags as string[]).map((flag, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[9px]">
                      {flag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Connection hints */}
            {(prov?.connection_hints as string[] | undefined)?.length ? (
              <div className="mt-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Connection Hints</p>
                {(prov!.connection_hints as string[]).map((hint, i) => (
                  <p key={i} className="text-[10px] text-gray-500 leading-relaxed">• {hint}</p>
                ))}
              </div>
            ) : null}
          </>
        )}

        {/* ── Signals tab ── */}
        {activeTab === "signals" && (
          <>
            {entitySignals.length === 0 ? (
              <p className="text-[11px] text-gray-400 italic">No signals for this entity.</p>
            ) : (
              entitySignals.map((signal) => (
                <div key={signal.id} className="rounded-md border border-gray-100 px-2.5 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={cn(
                      "h-2 w-2 rounded-full flex-shrink-0",
                      signal.severity === "high" ? "bg-red-500" :
                      signal.severity === "medium" ? "bg-amber-500" :
                      "bg-green-500"
                    )} />
                    <span className="text-[11px] font-medium text-gray-700 flex-1 truncate">
                      {signal.type.replace(/_/g, " ")}
                    </span>
                    <span className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded font-medium",
                      signal.status === "active" ? "bg-blue-50 text-blue-600" :
                      signal.status === "escalated" ? "bg-red-50 text-red-600" :
                      signal.status === "resolved" ? "bg-green-50 text-green-600" :
                      "bg-gray-100 text-gray-500"
                    )}>
                      {signal.status ?? "active"}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed">{signal.description}</p>

                  {/* Triage actions */}
                  <div className="flex gap-1 mt-2">
                    {(["dismissed", "investigating", "escalated", "resolved"] as SignalStatus[]).map((status) => (
                      <button
                        key={status}
                        onClick={() => onSignalAction(signal.id, status)}
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
                          signal.status === status
                            ? "bg-interaxis-50 text-interaxis-600"
                            : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                        )}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
