"use client";

import { X, Radar, ExternalLink, Zap, AlertTriangle, GitBranch, Layers, Target, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Ring } from "@/components/ui/ring";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { getNodeColor } from "@/lib/design-tokens";
import type { Entity, Edge, Cycle, Claim } from "@/types";
import type { InteractionField } from "@/types/interactions";
import type { ExternalCategory } from "@/types/intelligence";
import { CATEGORY_CONFIG, AUTHORITY_CONFIG } from "@/types/intelligence";
import { EvidenceSection } from "@/components/entity/evidence-section";
import { CausalRoleBadge } from "@/components/entity/causal-role-badge";
import { EdgeVerdictWidget } from "@/components/graph/edge-verdict-widget";
import { useFullscreenDrawer } from "@/components/canvas/drawers/use-fullscreen-drawer";
import { DrawerFullscreenButton } from "@/components/canvas/drawers/drawer-fullscreen-button";

interface NodeDetailProps {
  entity: Entity;
  edges: Edge[];
  entityMap: Map<string, Entity>;
  interactionField?: InteractionField | null;
  cycles?: Cycle[];
  claims?: Claim[];
  onClose: () => void;
  onDecompose?: (entity: Entity) => void;
  /** Expand internal structure — lightweight shell expansion */
  onExpand?: (entity: Entity) => void;
  onAcceptExternal?: (entity: Entity) => void;
  onRemoveExternal?: (entity: Entity) => void;
  /** Open this entity in the Intelligence Radar (Phase 2.6) */
  onOpenInRadar?: (entity: Entity) => void;
  /** Navigate to a dashboard section by ID (switches to dashboard view + scrolls) */
  onNavigateToSection?: (sectionId: string) => void;
  /** Run a reasoning operation with this entity pre-selected */
  onRunReasoning?: (op: "cascade" | "path" | "centrality" | "cycles" | "link_prediction") => void;
  /** Space ID — when provided, enables the "Analyze probability space" link */
  spaceId?: string;
}

export function NodeDetail({
  entity,
  edges,
  entityMap,
  onClose,
  onDecompose,
  onExpand,
  interactionField,
  cycles,
  claims = [],
  onAcceptExternal,
  onRemoveExternal,
  onOpenInRadar,
  onNavigateToSection,
  onRunReasoning,
  spaceId,
}: NodeDetailProps) {
  const isExternal = entity.knowledge_layer === "external";
  const colors = getNodeColor(entity.entity_category);
  const { isFullscreen, toggleFullscreen } = useFullscreenDrawer(true);

  // Filter claims linked to this entity
  const entityClaims = claims.filter(
    (c) => c.source_entity_id === entity.id
  );

  // Get edges connected to this entity — check both UUID (entity.id) and string entity_id
  const connectedEdges = edges.filter(
    (e) =>
      e.source_entity_id === entity.id ||
      e.target_entity_id === entity.id ||
      e.source_entity_id === entity.entity_id ||
      e.target_entity_id === entity.entity_id
  );

  // Compute context-aware navigation links
  const isInCycle = cycles?.some((c) => {
    const eids = (c.entity_ids as string[]) ?? [];
    return eids.includes(entity.entity_id) || eids.includes(entity.id);
  });
  const hasCrossContextEdges = connectedEdges.some(
    (e) => e.knowledge_layer === "bridge" || e.knowledge_layer === "external"
  );

  const importanceMap: Record<string, "fundamental" | "critical" | "important"> = {
    fundamental: "fundamental",
    critical: "critical",
    important: "important",
  };

  const sourceTagMap: Record<string, "stated" | "inferred" | "predicted"> = {
    explicit: "stated",
    implicit: "inferred",
    assumed: "predicted",
  };

  return (
    <div
      className={cn(
        "fixed right-0 top-0 z-50 flex h-full flex-col border-l border-gray-200 bg-white shadow-lg transition-[width] duration-200 ease-out",
        isFullscreen ? "w-screen" : "w-[380px]",
      )}
      style={{
        animation: "slideInRight 300ms ease forwards",
      }}
    >
      {/* Header */}
      <div className="border-b border-gray-200 px-5 py-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-[15px] font-semibold text-gray-900 leading-tight">
            {entity.name}
          </h2>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Ring value={entity.confidence} size={38} />
            <DrawerFullscreenButton
              isFullscreen={isFullscreen}
              onToggle={toggleFullscreen}
            />
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:text-gray-700"
              title="Close drawer"
              aria-label="Close drawer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* External indicator */}
        {isExternal && (
          <div className="mb-2 flex items-center gap-1.5 text-[10px] text-purple-600">
            <span className="h-2 w-2 rounded-full border border-current" style={{ borderStyle: "dashed" }} />
            External knowledge
          </div>
        )}

        {/* Badges */}
        <div className="flex flex-wrap gap-1">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: colors.fill,
              color: colors.stroke,
            }}
          >
            {entity.entity_category}
          </span>
          {entity.importance && importanceMap[entity.importance] && (
            <StatusBadge variant={importanceMap[entity.importance]}>
              {entity.importance}
            </StatusBadge>
          )}
          <StatusBadge variant={sourceTagMap[entity.source_tag] ?? "stated"}>
            {entity.source_tag}
          </StatusBadge>
          {entity.is_leverage_point && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
              LEVERAGE
            </span>
          )}
          {entity.is_risk_point && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700">
              RISK
            </span>
          )}
          {entity.centrality_rank && entity.centrality_rank <= 3 && (
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700">
              #{entity.centrality_rank}
            </span>
          )}
          <CausalRoleBadge role={(entity as Record<string, unknown>).causal_role as string | null} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Description */}
        {entity.description && (
          <div>
            <p className="text-[13px] leading-[1.6] text-gray-600">
              {entity.description}
            </p>
          </div>
        )}

        {/* Evidence Basis */}
        {entityClaims.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Evidence Basis
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
                {entityClaims.length}
              </span>
            </h3>
            <EvidenceSection
              claims={entityClaims}
              initialLimit={connectedEdges.length > 10 ? 3 : 2}
            />
          </div>
        )}

        {/* Properties */}
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Properties
          </h3>
          <div className="space-y-1.5 text-[12px]">
            {entity.entity_type && (
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className="text-gray-700">{entity.entity_type}</span>
              </div>
            )}
            {entity.blast_radius != null && entity.blast_radius !== 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Blast radius</span>
                <span className={cn(
                  "font-medium",
                  entity.blast_radius > 3 ? "text-red-600" :
                  entity.blast_radius > 1 ? "text-amber-600" :
                  "text-gray-700"
                )}>
                  {entity.blast_radius}
                </span>
              </div>
            )}
            {entity.centrality_rank && (
              <div className="flex justify-between">
                <span className="text-gray-500">Centrality rank</span>
                <span className="text-gray-700">#{entity.centrality_rank}</span>
              </div>
            )}
            {entity.layer && (
              <div className="flex justify-between">
                <span className="text-gray-500">Layer</span>
                <span className="text-gray-700">{entity.layer}</span>
              </div>
            )}
            {(entity as any).ambiguity_type && (
              <div className="flex justify-between">
                <span className="text-gray-500">Ambiguity</span>
                <span className={cn(
                  "font-medium",
                  (entity as any).ambiguity_type === "harmful" && "text-red-600",
                  (entity as any).ambiguity_type === "premature" && "text-amber-600",
                  (entity as any).ambiguity_type === "strategic" && "text-green-600",
                )}>
                  {(entity as any).ambiguity_type}
                </span>
              </div>
            )}
            {(entity as any).temporal_validity && (
              <>
                {(entity as any).temporal_validity.temporal_scope && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Time scope</span>
                    <span className="text-gray-700 text-right max-w-[160px]">{(entity as any).temporal_validity.temporal_scope}</span>
                  </div>
                )}
                {(entity as any).temporal_validity.decay_rate && (entity as any).temporal_validity.decay_rate !== "none" && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Decay</span>
                    <span className={cn(
                      "font-medium",
                      (entity as any).temporal_validity.decay_rate === "immediate" && "text-red-600",
                      (entity as any).temporal_validity.decay_rate === "fast" && "text-amber-600",
                      (entity as any).temporal_validity.decay_rate === "moderate" && "text-yellow-600",
                      (entity as any).temporal_validity.decay_rate === "slow" && "text-green-600",
                    )}>
                      {(entity as any).temporal_validity.decay_rate}
                    </span>
                  </div>
                )}
              </>
            )}
            {(entity as any).manifold && (
              <>
                {(entity as any).manifold.strategic && (
                  <div className="mt-3">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Strategic</h4>
                    <div className="space-y-1">
                      {(entity as any).manifold.strategic.alignment_to_goal && (
                        <div className="flex justify-between text-[12px]">
                          <span className="text-gray-500">Goal alignment</span>
                          <span className={cn(
                            "font-medium",
                            (entity as any).manifold.strategic.alignment_to_goal === "high" && "text-green-600",
                            (entity as any).manifold.strategic.alignment_to_goal === "low" && "text-gray-400",
                          )}>
                            {(entity as any).manifold.strategic.alignment_to_goal}
                          </span>
                        </div>
                      )}
                      {(entity as any).manifold.strategic.reversibility && (
                        <div className="flex justify-between text-[12px]">
                          <span className="text-gray-500">Reversibility</span>
                          <span className={cn(
                            "font-medium",
                            (entity as any).manifold.strategic.reversibility === "irreversible" && "text-red-600",
                            (entity as any).manifold.strategic.reversibility === "costly_to_reverse" && "text-amber-600",
                            (entity as any).manifold.strategic.reversibility === "easily_reversible" && "text-green-600",
                          )}>
                            {((entity as any).manifold.strategic.reversibility as string)?.replace(/_/g, " ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {(entity as any).manifold.epistemic && (
                  <div className="mt-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Evidence</h4>
                    <div className="space-y-1">
                      {(entity as any).manifold.epistemic.evidence_strength && (
                        <div className="flex justify-between text-[12px]">
                          <span className="text-gray-500">Evidence</span>
                          <span className={cn(
                            "font-medium",
                            (entity as any).manifold.epistemic.evidence_strength === "empirical" && "text-green-600",
                            (entity as any).manifold.epistemic.evidence_strength === "assumed" && "text-red-600",
                          )}>
                            {(entity as any).manifold.epistemic.evidence_strength}
                          </span>
                        </div>
                      )}
                      {(entity as any).manifold.epistemic.consensus_level && (
                        <div className="flex justify-between text-[12px]">
                          <span className="text-gray-500">Consensus</span>
                          <span className={cn(
                            "font-medium",
                            (entity as any).manifold.epistemic.consensus_level === "established" && "text-green-600",
                            (entity as any).manifold.epistemic.consensus_level === "contested" && "text-red-600",
                          )}>
                            {(entity as any).manifold.epistemic.consensus_level}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {(entity as any).manifold.operational?.maturity && (
                  <div className="mt-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Operational</h4>
                    <div className="flex justify-between text-[12px]">
                      <span className="text-gray-500">Maturity</span>
                      <span className={cn(
                        "font-medium",
                        (entity as any).manifold.operational.maturity === "proven" && "text-green-600",
                        (entity as any).manifold.operational.maturity === "theoretical" && "text-purple-600",
                        (entity as any).manifold.operational.maturity === "experimental" && "text-amber-600",
                      )}>
                        {(entity as any).manifold.operational.maturity}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Provenance — pipeline agent + timestamps */}
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Provenance
          </h3>
          <div className="space-y-1.5 text-[12px]">
            <div className="flex justify-between">
              <span className="text-gray-500">Pipeline</span>
              <span className={cn(
                "font-medium",
                entity.knowledge_layer === "external" && "text-purple-600",
                entity.knowledge_layer === "bridge" && "text-amber-600",
                entity.knowledge_layer === "internal" && "text-blue-600",
                entity.knowledge_layer === "conceptual" && "text-indigo-600",
              )}>
                {entity.knowledge_layer === "internal" ? "Decomposition"
                  : entity.knowledge_layer === "external" ? "Research Agent"
                  : entity.knowledge_layer === "bridge" ? "Bridge Builder"
                  : entity.knowledge_layer === "conceptual" ? "Analysis"
                  : entity.knowledge_layer}
              </span>
            </div>
            {(entity as any).created_at && (
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-600 text-[11px]">
                  {new Date((entity as any).created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
            )}
            {(entity as any).updated_at && (entity as any).updated_at !== (entity as any).created_at && (
              <div className="flex justify-between">
                <span className="text-gray-500">Updated</span>
                <span className="text-gray-600 text-[11px]">
                  {new Date((entity as any).updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
            )}
            {entity.provenance && (() => {
              const prov = entity.provenance as Record<string, unknown>;
              const agent = prov.discovered_by_agent as string | undefined;
              const runId = prov.research_run_id as string | undefined;
              if (!agent && !runId) return null;
              return (
                <>
                  {agent && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Agent</span>
                      <span className="text-purple-600 text-[11px] font-medium max-w-[170px] truncate">
                        {agent}
                      </span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* Interaction field */}
        {interactionField && interactionField.field_strength > 0 && (
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Influence Field
            </h3>
            <div className="space-y-1.5 text-[12px]">
              <div className="flex justify-between">
                <span className="text-gray-500">Field strength</span>
                <span className={cn(
                  "font-medium",
                  interactionField.field_strength >= 0.7 && "text-amber-600",
                  interactionField.field_strength >= 0.4 && interactionField.field_strength < 0.7 && "text-blue-600",
                  interactionField.field_strength < 0.4 && "text-gray-500",
                )}>
                  {Math.round(interactionField.field_strength * 100)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Reach</span>
                <span className="text-gray-700">{interactionField.field_reach} entities</span>
              </div>
              {interactionField.amplification_factor > 1 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Amplification</span>
                  <span className="font-medium text-purple-600">
                    x{interactionField.amplification_factor}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Role</span>
                <span className={cn(
                  "font-medium",
                  interactionField.autonomy_ratio > 2 && "text-amber-600",
                  interactionField.autonomy_ratio < 0.5 && "text-blue-600",
                )}>
                  {interactionField.autonomy_ratio > 2 ? "System driver" :
                   interactionField.autonomy_ratio < 0.5 ? "Downstream effect" : "Balanced"}
                </span>
              </div>
            </div>
            {/* Top influences */}
            {interactionField.top_influences.length > 0 && (
              <div className="mt-2 space-y-1">
                {interactionField.top_influences.slice(0, 4).map((inf) => (
                  <div
                    key={inf.target_entity_id}
                    className="rounded-md bg-gray-50 px-2.5 py-1.5 text-[11px]"
                  >
                    <span className={inf.net_influence > 0 ? "text-green-600" : "text-red-500"}>
                      {inf.net_influence > 0 ? "+" : ""}{inf.net_influence}
                    </span>{" "}
                    <span className="font-medium text-gray-700">
                      {inf.target_name}
                    </span>{" "}
                    <span className="text-gray-400">
                      ({inf.pathway})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Connected edges */}
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            <span>Connections</span>
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
              connectedEdges.length > 0
                ? "bg-indigo-100 text-indigo-700"
                : "bg-gray-100 text-gray-500"
            )}>
              {connectedEdges.length}
            </span>
          </h3>
          <div className="space-y-1.5">
            {connectedEdges.map((edge) => {
              const isSource =
                edge.source_entity_id === entity.id ||
                edge.source_entity_id === entity.entity_id;
              const otherId = isSource
                ? edge.target_entity_id
                : edge.source_entity_id;
              // entityMap may be keyed by entity_id or UUID — try both
              const other = entityMap.get(otherId) ??
                Array.from(entityMap.values()).find(
                  (e) => e.id === otherId || e.entity_id === otherId
                );

              // Determine edge quality indicators
              const edgeConf = typeof edge.confidence === "number" ? edge.confidence : 0.5;
              const isPredicted = edge.source_tag === "predicted";

              return (
                <div
                  key={edge.id}
                  className="rounded-md bg-gray-50 px-2.5 py-2 text-[11px] hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={isSource ? "text-blue-500" : "text-purple-500"}>
                        {isSource ? "→" : "←"}
                      </span>
                      <span className="font-medium text-gray-700 truncate">
                        {other?.name ?? otherId}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isPredicted && (
                        <span className="rounded bg-amber-100 px-1 py-0.5 text-[8px] font-medium text-amber-600">
                          predicted
                        </span>
                      )}
                      <span className={`rounded px-1 py-0.5 text-[8px] font-medium ${
                        edgeConf >= 0.7 ? "bg-green-100 text-green-600" :
                        edgeConf >= 0.4 ? "bg-amber-100 text-amber-600" :
                        "bg-red-100 text-red-600"
                      }`}>
                        {Math.round(edgeConf * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400">
                    <span>{edge.relationship_type?.replace(/_/g, " ")} · {edge.dimension}</span>
                    {spaceId && (
                      <EdgeVerdictWidget
                        spaceId={spaceId}
                        edge={edge}
                        density="compact"
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {connectedEdges.length === 0 && (
              <p className="text-[11px] text-gray-400">No connections found</p>
            )}
          </div>
        </div>
      </div>

      {/* Provenance + Intelligence Context (for external entities — Phase 2.6) */}
      {isExternal && entity.provenance && (() => {
        const prov = entity.provenance as Record<string, unknown>;
        const category = (prov?.category as ExternalCategory) ?? null;
        const catConfig = category ? CATEGORY_CONFIG[category] : null;
        const authConfig = AUTHORITY_CONFIG[(entity.authority_level ?? "unverified") as keyof typeof AUTHORITY_CONFIG];
        const citationUrls = Array.isArray(prov?.citation_urls)
          ? (prov.citation_urls as string[]).filter(Boolean)
          : [];
        const bridgeEdgesForEntity = connectedEdges.filter((e) => e.knowledge_layer === "bridge");

        return (
          <div className="border-t border-gray-200 px-5 py-3 space-y-3">
            {/* Category + Authority badges */}
            <div className="flex items-center gap-2 flex-wrap">
              {catConfig && (
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border",
                  catConfig.bg, catConfig.color, "border-current/10"
                )}>
                  <span>{catConfig.icon}</span>
                  {catConfig.label}
                </span>
              )}
              {authConfig && (
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  authConfig.bg, authConfig.color
                )}>
                  {authConfig.label}
                </span>
              )}
            </div>

            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Source
            </h3>
            <div className="space-y-1.5 text-[12px]">
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className="text-gray-700">
                  {(prov.source_type as string) === "web_search" || (prov.source_type as string) === "web_search_enhanced"
                    ? "Web search"
                    : (prov.source_type as string) ?? "Training knowledge"}
                </span>
              </div>
              {/* Source URL link */}
              {typeof prov.source_url === "string" && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Source</span>
                  <a
                    href={prov.source_url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 max-w-[180px] truncate text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    {(() => {
                      try { return new URL(prov.source_url as string).hostname.replace("www.", ""); } catch { return "View source"; }
                    })()}
                    <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                  </a>
                </div>
              )}
              {typeof prov.confidence_basis === "string" && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Basis</span>
                  <span className="text-gray-600 text-[11px] max-w-[180px] truncate">
                    {prov.confidence_basis as string}
                  </span>
                </div>
              )}
            </div>

            {/* Relevance note */}
            {typeof prov.relevance === "string" && (
              <div className="rounded-md bg-purple-50 px-2.5 py-2 text-[11px] text-purple-700">
                {prov.relevance as string}
              </div>
            )}

            {/* Citation URLs (Phase 2.6 — multiple sources) */}
            {citationUrls.length > 0 && (
              <div>
                <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Citations ({citationUrls.length})
                </h4>
                <div className="space-y-1">
                  {citationUrls.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                      <span className="truncate">
                        {(() => {
                          try { return new URL(url).hostname.replace("www.", ""); } catch { return url.slice(0, 40); }
                        })()}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Bridge connections */}
            {bridgeEdgesForEntity.length > 0 && (
              <div>
                <h4 className="mb-1 text-[10px] font-semibold text-amber-600">
                  Connected to your analysis ({bridgeEdgesForEntity.length})
                </h4>
                {bridgeEdgesForEntity.map((edge) => {
                  const otherId =
                    edge.source_entity_id === entity.id
                      ? edge.target_entity_id
                      : edge.source_entity_id;
                  const other = entityMap.get(otherId);
                  const isLeverage = other?.is_leverage_point;
                  const isRisk = other?.is_risk_point;

                  return (
                    <div key={edge.id} className={cn(
                      "rounded-md px-2.5 py-1.5 text-[11px] mb-1",
                      isLeverage ? "bg-green-50" : isRisk ? "bg-red-50" : "bg-amber-50"
                    )}>
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          "font-medium",
                          isLeverage ? "text-green-700" : isRisk ? "text-red-700" : "text-amber-700"
                        )}>
                          {edge.relationship_type}
                        </span>
                        {isLeverage && (
                          <span className="rounded-full bg-green-100 px-1 text-[8px] font-bold text-green-600">
                            LEVERAGE
                          </span>
                        )}
                        {isRisk && (
                          <span className="rounded-full bg-red-100 px-1 text-[8px] font-bold text-red-600">
                            RISK
                          </span>
                        )}
                      </div>
                      <span className="text-gray-600">
                        {other?.name ?? otherId}
                      </span>
                      {edge.conditions && (
                        <div className="mt-0.5 text-[10px] text-gray-500">{edge.conditions}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Open in Radar button */}
            {onOpenInRadar && (
              <button
                onClick={() => onOpenInRadar(entity)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[10px] font-medium text-indigo-600 hover:bg-indigo-100 transition-colors"
              >
                <Radar className="h-3 w-3" />
                Open in Intelligence Radar
              </button>
            )}
          </div>
        );
      })()}

      {/* Navigate — context-aware deep links to downstream artifacts */}
      {(onNavigateToSection || onRunReasoning) && (
        <div className="border-t border-gray-200 px-5 py-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Navigate
          </h3>
          <div className="space-y-1">
            {/* Leverage analysis — falls back to strategy section */}
            {entity.is_leverage_point && onNavigateToSection && (
              <button
                onClick={() => onNavigateToSection("section-leverage|section-strategy")}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
              >
                <Zap className="h-3 w-3 flex-shrink-0" />
                <span>View leverage analysis</span>
                <ArrowRight className="h-2.5 w-2.5 ml-auto flex-shrink-0 opacity-40" />
              </button>
            )}
            {/* Risk analysis */}
            {entity.is_risk_point && onNavigateToSection && (
              <button
                onClick={() => onNavigateToSection("section-risks|section-strategy")}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 transition-colors text-left"
              >
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                <span>View risk analysis</span>
                <ArrowRight className="h-2.5 w-2.5 ml-auto flex-shrink-0 opacity-40" />
              </button>
            )}
            {/* Feedback loops */}
            {isInCycle && onNavigateToSection && (
              <button
                onClick={() => onNavigateToSection("section-loops|section-strategy")}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors text-left"
              >
                <GitBranch className="h-3 w-3 flex-shrink-0" />
                <span>View in feedback loops</span>
                <ArrowRight className="h-2.5 w-2.5 ml-auto flex-shrink-0 opacity-40" />
              </button>
            )}
            {/* Cross-context insights */}
            {hasCrossContextEdges && onNavigateToSection && (
              <button
                onClick={() => onNavigateToSection("section-external|section-insights")}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left"
              >
                <Layers className="h-3 w-3 flex-shrink-0" />
                <span>View cross-context insights</span>
                <ArrowRight className="h-2.5 w-2.5 ml-auto flex-shrink-0 opacity-40" />
              </button>
            )}
            {/* Bottleneck analysis */}
            {(entity as any).is_master_bottleneck && onNavigateToSection && (
              <button
                onClick={() => onNavigateToSection("section-bottleneck|section-strategy")}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 transition-colors text-left"
              >
                <Target className="h-3 w-3 flex-shrink-0" />
                <span>View bottleneck analysis</span>
                <ArrowRight className="h-2.5 w-2.5 ml-auto flex-shrink-0 opacity-40" />
              </button>
            )}
            {/* Reasoning operations — always available */}
            {onRunReasoning && (
              <>
                <button
                  onClick={() => onRunReasoning("cascade")}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                >
                  <Zap className="h-3 w-3 flex-shrink-0 text-red-400" />
                  <span>Simulate cascade failure</span>
                  <ArrowRight className="h-2.5 w-2.5 ml-auto flex-shrink-0 opacity-40" />
                </button>
                <button
                  onClick={() => onRunReasoning("path")}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                >
                  <GitBranch className="h-3 w-3 flex-shrink-0 text-blue-400" />
                  <span>Find shortest paths from here</span>
                  <ArrowRight className="h-2.5 w-2.5 ml-auto flex-shrink-0 opacity-40" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-gray-200 px-5 py-3 space-y-2">
        {entity.is_decomposable && onDecompose && (
          <Button
            onClick={() => onDecompose(entity)}
            className="w-full"
            size="sm"
          >
            Analyze this entity
          </Button>
        )}
        {onExpand && entity.knowledge_layer !== "external" && (
          <Button
            onClick={() => onExpand(entity)}
            className="w-full"
            size="sm"
            variant="secondary"
          >
            Expand internal structure
          </Button>
        )}
        {spaceId && (
          <Link
            href={`/app/space/${spaceId}/entity/${entity.id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-interaxis-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-interaxis-700"
            title="Open the full entity canvas with sub-components, evidence, and upstream/downstream context"
          >
            Open full entity view →
          </Link>
        )}
        {spaceId && entity.knowledge_layer !== "external" && (
          <Link
            href={`/app/space/${spaceId}/probability/node/${entity.id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
            title="Enumerate convergent outcomes of this entity combined with different interactors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Analyze probability space
          </Link>
        )}
        {isExternal && onAcceptExternal && (
          <Button
            onClick={() => onAcceptExternal(entity)}
            className="w-full"
            size="sm"
            variant="secondary"
          >
            Accept into analysis
          </Button>
        )}
        {isExternal && onRemoveExternal && (
          <Button
            onClick={() => onRemoveExternal(entity)}
            className="w-full"
            size="sm"
            variant="ghost"
          >
            Remove from graph
          </Button>
        )}
      </div>

      <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
