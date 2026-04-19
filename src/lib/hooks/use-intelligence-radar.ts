"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Space, Entity, Edge } from "@/types";
import type { SynthesisData, CrossContextInsight, HiddenSignalData, ContinuationSignalData } from "@/types/synthesis";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";
import type { StrategicRecommendation, StrategicRecommendationData } from "@/types/strategy";
import type {
  RadarSummary,
  RadarFilterState,
  OrbitalRing,
  ConnectionAnalysis,
  ConnectionPath,
  StrategyLink,
  IntelligenceSignal,
  IntelligenceRadarData,
  ResearchSchedule,
  ExternalCategory,
  SignalStatus,
  DEFAULT_RADAR_FILTERS,
  EpistemicNodeType,
  SourceCredibility,
  ResearchAgent,
} from "@/types/intelligence";
import { RING_CONFIG } from "@/types/intelligence";
import type {
  IntelligenceRadarDataV2,
  TemporalIntelligence,
  CoverageImprovementRec,
  EntityVerdictWeight,
  StackHealth,
  KnowledgeStackCounts,
  LandscapeCluster,
} from "@/types/intelligence-v2";
import { isBridgeLikeEdge } from "@/lib/intelligence/bridge-semantics";
import {
  computeTemporalIntelligence,
  computeCoverageImprovements,
} from "@/lib/intelligence/temporal-intelligence";
import {
  computeVerdictFromStatus,
  recordVerdict,
  computeEntityVerdictWeights,
  applyVerdictBonus,
} from "@/lib/intelligence/feedback-learning";

// ── Callsign helpers ──

const CALLSIGN_POOL = ["ATLAS", "ORION", "VEGA", "HELIOS", "LYRA", "NOVA", "CYGNUS", "RIGEL"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function generateCallsign(seed: string, index: number): string {
  const name = CALLSIGN_POOL[hashString(seed) % CALLSIGN_POOL.length];
  const suffix = String((hashString(seed) + index) % 100).padStart(2, "0");
  return `${name}-${suffix}`;
}

function formatObjectiveSpecialty(obj: SuggestedObjective): string {
  if (obj.propellant?.mechanism) {
    const m = obj.propellant.mechanism.replace(/_/g, " ");
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  if (obj.depth === "fundamental") return "Fundamental convergence";
  if (obj.depth === "structural") return "Structural pattern";
  return `${obj.objective_type} ${obj.metric_name}`;
}

function formatGoalSpecialty(goal: ImprovementGoal): string {
  const type = goal.objective_type ?? "maintain";
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} · ${goal.metric_name}`;
}

// ── Suggested bridge type ──

export interface SuggestedBridge {
  externalEntity: Entity;
  internalEntity: Entity;
  score: number;
  sharedTerms: string[];
}

export interface PriorityDecision {
  id: string;
  signal_id: string;
  entity_id: string;
  entity_name: string;
  bucket: "now" | "next" | "watch";
  urgency_score: number;
  action_label: string;
  rationale: string;
  related_internal_entities: string[];
  detected_at: string;
}

export interface CoverageBreakdown {
  quantity_ratio: number;
  bridge_coverage: number;
  authority_quality: number;
  category_diversity: number;
}

// ── Word overlap scoring helper ──

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

function wordOverlapScore(
  textA: string,
  textB: string,
): { score: number; sharedTerms: string[] } {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  if (tokensA.length === 0 || tokensB.length === 0) return { score: 0, sharedTerms: [] };

  const setB = new Set(tokensB);
  const shared = [...new Set(tokensA)].filter((w) => setB.has(w));
  const score = shared.length / Math.max(tokensA.length, tokensB.length);
  return { score, sharedTerms: shared };
}

// ── Cluster color palette — assigned round-robin to auto-generated clusters ──

const CLUSTER_PALETTE = [
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#06B6D4", // cyan
  "#EC4899", // pink
  "#14B8A6", // teal
  "#F97316", // orange
  "#6366F1", // indigo
];

// ── Cluster key derivation for graph clustering ──

function clusterKeyForEntity(e: Entity): string {
  // External entities: cluster by domain category
  const prov = e.provenance as Record<string, unknown> | null;
  const cat = prov?.category as string | undefined;
  if (cat && cat !== "uncategorized") return cat;

  // Internal entities: cluster by entity_category or structural role
  if (e.entity_category) return e.entity_category;

  // Use importance/role as fallback grouping
  if (e.is_leverage_point) return "leverage_points";
  if (e.is_risk_point) return "risk_factors";
  if (e.is_master_bottleneck) return "bottlenecks";

  // Use knowledge layer as last resort
  if (e.knowledge_layer === "bridge") return "bridge_concepts";
  if (e.knowledge_layer === "conceptual") return "conceptual";

  return "core_entities";
}

// ── Types for hook return ──

interface UseIntelligenceRadarReturn {
  // Data
  externalEntities: Entity[];
  internalEntities: Entity[];
  bridgeEntities: Entity[];
  conceptualEntities: Entity[];
  bridgeEdges: Edge[];
  internalEdges: Edge[];
  externalEdges: Edge[];
  crossContextInsights: CrossContextInsight[];
  hiddenSignals: HiddenSignalData[];
  continuationSignals: ContinuationSignalData[];
  summary: RadarSummary;
  signals: IntelligenceSignal[];
  radarData: IntelligenceRadarData | null;

  // v2 data
  radarV2: IntelligenceRadarDataV2 | null;
  temporalIntelligence: TemporalIntelligence | null;
  coverageImprovements: CoverageImprovementRec[];
  crossLayerAnalysis: IntelligenceRadarDataV2["cross_layer_analysis"] | null;
  compositions: NonNullable<IntelligenceRadarDataV2["compositions"]>;

  // Computed
  entityRingMap: Map<string, OrbitalRing>;
  filteredExternalEntities: Entity[];
  connectionAnalysis: (entityId: string) => ConnectionAnalysis | null;
  suggestedBridges: SuggestedBridge[];
  priorityDecisions: PriorityDecision[];
  coverageBreakdown: CoverageBreakdown;

  // Filters
  filters: RadarFilterState;
  setFilters: (updater: (prev: RadarFilterState) => RadarFilterState) => void;

  // Actions
  triggerResearch: (depth?: string, focusAreas?: string[]) => Promise<void>;
  researchLoading: boolean;
  researchError: string | null;
  researchResult: { entitiesCreated: number; edgesCreated: number; bridgesCreated: number; searchesPerformed?: number } | null;
  dismissResearchResult: () => void;
  createBridgeEdge: (externalEntityId: string, internalEntityId: string) => Promise<void>;
  updateEntityAuthority: (entityDbId: string, level: "high" | "moderate" | "low" | "unverified") => Promise<void>;

  // Signal actions
  updateSignalStatus: (signalId: string, status: SignalStatus, note?: string) => Promise<void>;

  // Strategy bridge
  triggerStrategyRefresh: () => Promise<void>;
  strategyRefreshLoading: boolean;
  strategyRefreshResult: StrategyRefreshResult | null;
  escalatedSignalCount: number;
  strategyRefreshRecommended: boolean;
  strategyRefreshReason: string | null;

  // Schedule
  schedule: ResearchSchedule | null;
  updateSchedule: (schedule: Partial<ResearchSchedule>) => Promise<void>;

  // Selection
  selectedEntityId: string | null;
  setSelectedEntityId: (id: string | null) => void;

  // Intelligence tiers
  getTier: (entity: Entity) => "embedded" | "observatory";
  promoteTier: (entityId: string, newTier: "embedded" | "observatory") => Promise<void>;

  // Feature availability
  hasExternalData: boolean;

  // Knowledge Stack (v3)
  stackCounts: KnowledgeStackCounts;
  stackHealth: StackHealth;
  agentFleet: ResearchAgent[];
  floatingEntities: Entity[];
  epistemicTypeMap: Map<string, EpistemicNodeType>;
  credibilityMap: Map<string, SourceCredibility>;
  graphClusters: LandscapeCluster[];

  // Synthesis data + derived fields — exposed so consumers (e.g.
  // intelligence-radar-module) can resolve axiom backlinks, render
  // insight convergences, and render expansion axioms without
  // re-parsing synthesis_data themselves.
  synthesisData: SynthesisData | null;
  axioms: SynthesisData["axioms"];
  insightConvergences: SynthesisData["insight_convergences"];
  assumptionInversions: SynthesisData["assumption_inversions"];
  expansionAxioms: SynthesisData["expansion_axioms"];
}

/** Result returned after a strategy refresh triggered from intelligence signals */
export interface StrategyRefreshResult {
  success: boolean;
  strategy_count?: number;
  top_strategy?: string;
  confidence?: number;
  /** The signals that influenced the refresh */
  influencing_signals: IntelligenceSignal[];
  error?: string;
}

/**
 * Core hook for the Strategic Intelligence Radar.
 *
 * Computes orbital ring assignments, filters, connection analysis,
 * and manages research triggering — all from existing data.
 */
export function useIntelligenceRadar(
  space: Space,
  entities: Entity[],
  edges: Edge[],
  goals: ImprovementGoal[] = [],
): UseIntelligenceRadarReturn {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  // ── Local state ──

  const [filters, setFilters] = useState<RadarFilterState>({
    categories: new Set([
      "competitor", "framework", "pattern", "data_point",
      "analogy", "risk_pattern", "resource",
    ] as ExternalCategory[]),
    authorityLevels: new Set(["high", "moderate", "low", "unverified"] as const),
    ring: "all",
    sortBy: "relevance",
    searchQuery: "",
    tier: "all",
  });

  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchResult, setResearchResult] = useState<{ entitiesCreated: number; edgesCreated: number; bridgesCreated: number; searchesPerformed?: number } | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // ── Parse synthesis data ──

  const parsedSynth: SynthesisData | null = useMemo(() => {
    if (!space.synthesis_data) return null;
    try {
      return (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  }, [space.synthesis_data]);

  const strategyRec: StrategicRecommendation | null = useMemo(() => {
    const sd = parsedSynth?.strategic_recommendation as StrategicRecommendationData | undefined;
    return sd?.recommendation ?? null;
  }, [parsedSynth]);

  const radarData: IntelligenceRadarData | null = useMemo(() => {
    if (!parsedSynth) return null;
    return (parsedSynth as unknown as Record<string, unknown>).intelligence_radar as IntelligenceRadarData | null ?? null;
  }, [parsedSynth]);

  // ── Parse v2 radar data (backward-compatible) ──

  const radarV2: IntelligenceRadarDataV2 | null = useMemo(() => {
    if (!parsedSynth) return null;
    return (parsedSynth as unknown as Record<string, unknown>).intelligence_radar_v2 as IntelligenceRadarDataV2 | null ?? null;
  }, [parsedSynth]);

  // ── Partition entities by knowledge layer ──

  const { internalEntities, externalEntities, bridgeEntities, conceptualEntities } = useMemo(() => {
    const internal: Entity[] = [];
    const external: Entity[] = [];
    const bridge: Entity[] = [];
    const conceptual: Entity[] = [];

    for (const e of entities) {
      switch (e.knowledge_layer) {
        case "external": external.push(e); break;
        case "bridge": bridge.push(e); break;
        case "conceptual": conceptual.push(e); break;
        default: internal.push(e); break;
      }
    }

    return { internalEntities: internal, externalEntities: external, bridgeEntities: bridge, conceptualEntities: conceptual };
  }, [entities]);

  // ── Partition edges (v2: bridge-like semantics) ──
  // Uses isBridgeLikeEdge() to catch discovered edges with edge_role: "discovered"
  // in addition to explicit knowledge_layer: "bridge" and cross-layer edges.

  const entityLayerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) {
      map.set(e.entity_id, e.knowledge_layer ?? "internal");
      map.set(e.id, e.knowledge_layer ?? "internal");
    }
    return map;
  }, [entities]);

  const { bridgeEdges, internalEdges, externalEdges } = useMemo(() => {
    const bridgeE: Edge[] = [];
    const internalE: Edge[] = [];
    const externalE: Edge[] = [];

    // Map both UUID and entity_id to knowledge layer for robust matching
    const externalIds = new Set<string>();
    const internalIds = new Set<string>();
    for (const e of externalEntities) {
      externalIds.add(e.entity_id);
      externalIds.add(e.id); // UUID
    }
    for (const e of internalEntities) {
      internalIds.add(e.entity_id);
      internalIds.add(e.id); // UUID
    }

    for (const edge of edges) {
      // v2: Use bridge-like semantics for comprehensive detection
      if (isBridgeLikeEdge(edge, entityLayerMap)) {
        bridgeE.push(edge);
      } else {
        const srcExternal = externalIds.has(edge.source_entity_id);
        const tgtExternal = externalIds.has(edge.target_entity_id);
        if (srcExternal && tgtExternal) {
          externalE.push(edge);
        } else {
          internalE.push(edge);
        }
      }
    }

    return { bridgeEdges: bridgeE, internalEdges: internalE, externalEdges: externalE };
  }, [edges, externalEntities, internalEntities, entityLayerMap]);

  // ── Cross-context insights ──

  const crossContextInsights: CrossContextInsight[] = useMemo(() => {
    const raw = parsedSynth?.cross_context_insights;
    return Array.isArray(raw) ? raw : [];
  }, [parsedSynth]);

  // ── Hidden signals (from domain-expert research pipeline) ──

  const hiddenSignals: HiddenSignalData[] = useMemo(() => {
    const raw = parsedSynth?.hidden_signals;
    return Array.isArray(raw) ? raw : [];
  }, [parsedSynth]);

  // ── Continuation signals (research gaps identified by LLM) ──

  const continuationSignals: ContinuationSignalData[] = useMemo(() => {
    const raw = parsedSynth?.continuation_signals;
    return Array.isArray(raw) ? raw : [];
  }, [parsedSynth]);

  // ── Compute orbital ring for each entity ──

  const entityRingMap: Map<string, OrbitalRing> = useMemo(() => {
    const map = new Map<string, OrbitalRing>();

    // Internal entities → core ring
    // Priority: flagged entities always appear, then fill up to MIN_CORE with top-importance
    const importanceOrder: Record<string, number> = { fundamental: 0, critical: 1, important: 2, moderate: 3, minor: 4 };
    const MIN_CORE = Math.max(3, Math.min(8, Math.ceil(internalEntities.length * 0.4)));

    // First pass: all flagged or high-importance entities
    const coreEntities: Entity[] = [];
    const nonCoreInternal: Entity[] = [];
    for (const e of internalEntities) {
      if (
        e.is_leverage_point ||
        e.is_risk_point ||
        e.is_master_bottleneck ||
        e.importance === "fundamental" ||
        e.importance === "critical"
      ) {
        coreEntities.push(e);
      } else {
        nonCoreInternal.push(e);
      }
    }

    // If we have fewer than MIN_CORE flagged entities, backfill with top-importance internal entities
    if (coreEntities.length < MIN_CORE) {
      const sorted = [...nonCoreInternal].sort((a, b) =>
        (importanceOrder[a.importance ?? "moderate"] ?? 3) - (importanceOrder[b.importance ?? "moderate"] ?? 3)
      );
      for (const e of sorted) {
        if (coreEntities.length >= MIN_CORE) break;
        coreEntities.push(e);
      }
    }

    for (const e of coreEntities) {
      map.set(e.entity_id, "core");
    }

    // Conceptual entities (expansion-derived mechanisms) → conceptual ring
    for (const e of conceptualEntities) {
      map.set(e.entity_id, "conceptual");
    }

    // Bridge entities
    for (const e of bridgeEntities) {
      map.set(e.entity_id, "bridge");
    }

    // External entities: direct (has bridge) vs landscape (no bridge)
    // Build UUID↔entity_id map for robust matching (edges may use either format)
    const uuidToEntityId = new Map<string, string>();
    for (const e of externalEntities) {
      uuidToEntityId.set(e.id, e.entity_id);
      uuidToEntityId.set(e.entity_id, e.entity_id);
    }
    // Also map internal entities for bridge edge resolution
    const internalEntityIdLookup = new Map<string, string>();
    for (const e of internalEntities) {
      internalEntityIdLookup.set(e.id, e.entity_id);
      internalEntityIdLookup.set(e.entity_id, e.entity_id);
    }

    const bridgedExternalEntityIds = new Set<string>();
    const bridgedInternalEntityIds = new Set<string>();
    for (const edge of bridgeEdges) {
      const srcEntityId = uuidToEntityId.get(edge.source_entity_id);
      const tgtEntityId = uuidToEntityId.get(edge.target_entity_id);
      if (srcEntityId) bridgedExternalEntityIds.add(srcEntityId);
      if (tgtEntityId) bridgedExternalEntityIds.add(tgtEntityId);

      // Track internal entities that are bridge targets so they appear in the graph
      const srcInternalId = internalEntityIdLookup.get(edge.source_entity_id);
      const tgtInternalId = internalEntityIdLookup.get(edge.target_entity_id);
      if (srcInternalId) bridgedInternalEntityIds.add(srcInternalId);
      if (tgtInternalId) bridgedInternalEntityIds.add(tgtInternalId);
    }

    // Ensure internal entities that are bridge targets get into the core ring
    // even if they weren't flagged as high-importance
    for (const e of internalEntities) {
      if (!map.has(e.entity_id) && bridgedInternalEntityIds.has(e.entity_id)) {
        map.set(e.entity_id, "core");
      }
    }

    for (const e of externalEntities) {
      map.set(e.entity_id, bridgedExternalEntityIds.has(e.entity_id) ? "direct" : "landscape");
    }

    return map;
  }, [internalEntities, externalEntities, bridgeEntities, conceptualEntities, bridgeEdges]);

  // ── Filter external entities ──

  // ── Tier helper ──
  const getTier = useCallback((e: Entity): "embedded" | "observatory" => {
    const prov = e.provenance as Record<string, unknown> | null;
    // Manual override takes precedence
    if (prov?.intelligence_tier_manual) return prov.intelligence_tier_manual as "embedded" | "observatory";
    return (prov?.intelligence_tier as "embedded" | "observatory") ?? "observatory";
  }, []);

  const filteredExternalEntities = useMemo(() => {
    let filtered = externalEntities;

    // Tier filter
    if (filters.tier !== "all") {
      filtered = filtered.filter((e) => getTier(e) === filters.tier);
    }

    // Category filter
    if (filters.categories.size < 7) {
      filtered = filtered.filter((e) => {
        const prov = e.provenance as Record<string, unknown> | null;
        const cat = (prov?.category as ExternalCategory) ?? "pattern";
        return filters.categories.has(cat);
      });
    }

    // Authority filter
    if (filters.authorityLevels.size < 4) {
      filtered = filtered.filter((e) =>
        filters.authorityLevels.has((e.authority_level ?? "unverified") as never)
      );
    }

    // Ring filter
    if (filters.ring !== "all") {
      filtered = filtered.filter((e) => entityRingMap.get(e.entity_id) === filters.ring);
    }

    // Search filter
    if (filters.searchQuery.trim()) {
      const q = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.description ?? "").toLowerCase().includes(q)
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      switch (filters.sortBy) {
        case "authority": {
          const order = { high: 0, moderate: 1, low: 2, unverified: 3 };
          return (order[a.authority_level as keyof typeof order] ?? 3) -
            (order[b.authority_level as keyof typeof order] ?? 3);
        }
        case "category": {
          const pA = (a.provenance as Record<string, unknown>)?.category as string ?? "z";
          const pB = (b.provenance as Record<string, unknown>)?.category as string ?? "z";
          return pA.localeCompare(pB);
        }
        case "recency": {
          // Primary: use entity updated_at/created_at timestamps
          const dateA = new Date((a as Record<string, unknown>).updated_at as string || (a as Record<string, unknown>).created_at as string || 0).getTime();
          const dateB = new Date((b as Record<string, unknown>).updated_at as string || (b as Record<string, unknown>).created_at as string || 0).getTime();
          if (dateA !== dateB) return dateB - dateA; // newest first
          // Fallback: temporal_freshness from provenance
          const freshnessOrder: Record<string, number> = { current: 0, recent: 1, dated: 2, unknown: 3 };
          const fA = freshnessOrder[(a.provenance as Record<string, unknown>)?.temporal_freshness as string ?? "unknown"] ?? 3;
          const fB = freshnessOrder[(b.provenance as Record<string, unknown>)?.temporal_freshness as string ?? "unknown"] ?? 3;
          return fA !== fB ? fA - fB : (b.confidence ?? 0) - (a.confidence ?? 0);
        }
        case "relevance":
        default:
          return (b.confidence ?? 0) - (a.confidence ?? 0);
      }
    });

    return filtered;
  }, [externalEntities, filters, entityRingMap, getTier]);

  // ── Connection analysis for a specific external entity (Deep Mode — Phase 2.3) ──

  // Build entity lookup map (memoized) for multi-hop traversal
  const entityLookup = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) map.set(e.entity_id, e);
    return map;
  }, [entities]);

  // Build adjacency index (memoized) for multi-hop traversal
  const adjacencyIndex = useMemo(() => {
    const adj = new Map<string, Array<{ neighbor: string; edge: Edge }>>();
    for (const edge of edges) {
      const src = edge.source_entity_id;
      const tgt = edge.target_entity_id;
      if (!adj.has(src)) adj.set(src, []);
      if (!adj.has(tgt)) adj.set(tgt, []);
      adj.get(src)!.push({ neighbor: tgt, edge });
      adj.get(tgt)!.push({ neighbor: src, edge });
    }
    return adj;
  }, [edges]);

  const connectionAnalysis = useCallback(
    (entityId: string): ConnectionAnalysis | null => {
      const entity = externalEntities.find((e) => e.entity_id === entityId);
      if (!entity) return null;

      const ring = entityRingMap.get(entityId) ?? "landscape";
      const connections: ConnectionPath[] = [];
      const visitedInternalIds = new Set<string>();

      // ── Hop 1: Direct bridge edges ──
      // Match by both entity_id (slug) and id (UUID) for robustness
      const entityUUID = entity.id;
      for (const edge of bridgeEdges) {
        let internalId: string | null = null;
        if (edge.source_entity_id === entityId || edge.source_entity_id === entityUUID) {
          internalId = edge.target_entity_id;
        }
        if (edge.target_entity_id === entityId || edge.target_entity_id === entityUUID) {
          internalId = edge.source_entity_id;
        }
        if (!internalId) continue;

        // Find internal entity by either entity_id or UUID
        const internalEntity = internalEntities.find((e) => e.entity_id === internalId || e.id === internalId);
        if (!internalEntity) continue;

        visitedInternalIds.add(internalId);

        // Determine connection type based on internal entity's role
        let type: ConnectionPath["type"] = "bridges_to";
        if (internalEntity.is_leverage_point) type = "supports_leverage";
        else if (internalEntity.is_risk_point) type = "validates_risk";
        else if (internalEntity.is_master_bottleneck) type = "informs_strategy";

        // Check if edge is a "challenges" type
        if (edge.relationship_type?.toLowerCase().includes("challenge") ||
            edge.relationship_type?.toLowerCase().includes("contradict")) {
          type = "challenges";
        }

        // Check if external entity is a historical precedent (pattern/analogy category)
        const entityProv = entity.provenance as Record<string, unknown> | null;
        const entityCategory = entityProv?.category as string ?? "";
        if ((entityCategory === "pattern" || entityCategory === "analogy") && type === "bridges_to") {
          type = "precedent_for";
        }

        connections.push({
          type,
          internal_entity_id: internalId,
          internal_entity_name: internalEntity.name,
          reasoning: edge.relationship_type ?? "Connected via bridge",
          strength: edge.confidence ?? 0.5,
        });
      }

      // ── Hop 2: Multi-hop traversal (external → bridge → internal → adjacent internal) ──
      // For each directly-connected internal entity, find its high-importance neighbors
      // that the external entity indirectly impacts. Cap at 2 hops total, max 6 indirect.
      const MAX_INDIRECT = 6;
      let indirectCount = 0;

      for (const directId of [...visitedInternalIds]) {
        if (indirectCount >= MAX_INDIRECT) break;
        const neighbors = adjacencyIndex.get(directId) ?? [];

        for (const { neighbor: hop2Id, edge: hop2Edge } of neighbors) {
          if (indirectCount >= MAX_INDIRECT) break;
          if (visitedInternalIds.has(hop2Id)) continue;

          const hop2Entity = entityLookup.get(hop2Id);
          if (!hop2Entity) continue;
          // Only traverse to internal/conceptual entities that are structurally important
          if (hop2Entity.knowledge_layer !== "internal" && hop2Entity.knowledge_layer !== "conceptual") continue;
          if (
            !hop2Entity.is_leverage_point &&
            !hop2Entity.is_risk_point &&
            !hop2Entity.is_master_bottleneck &&
            hop2Entity.importance !== "fundamental" &&
            hop2Entity.importance !== "critical"
          ) continue;

          visitedInternalIds.add(hop2Id);
          indirectCount++;

          const directEntity = entityLookup.get(directId);
          let type: ConnectionPath["type"] = "bridges_to";
          if (hop2Entity.is_leverage_point) type = "supports_leverage";
          else if (hop2Entity.is_risk_point) type = "validates_risk";
          else if (hop2Entity.is_master_bottleneck) type = "informs_strategy";

          // Precedent detection for indirect connections too
          const entProv = entity.provenance as Record<string, unknown> | null;
          const entCat = entProv?.category as string ?? "";
          if ((entCat === "pattern" || entCat === "analogy") && type === "bridges_to") {
            type = "precedent_for";
          }

          // Indirect strength = product of hop1 and hop2 edge confidence (decayed)
          const hop1Conf = connections.find((c) => c.internal_entity_id === directId)?.strength ?? 0.5;
          const hop2Conf = hop2Edge.confidence ?? 0.5;
          const indirectStrength = hop1Conf * hop2Conf * 0.7; // 0.7 decay for indirection

          connections.push({
            type,
            internal_entity_id: hop2Id,
            internal_entity_name: hop2Entity.name,
            reasoning: `Via ${directEntity?.name ?? directId} → ${hop2Edge.relationship_type ?? "connected"} (2-hop)`,
            strength: Math.round(indirectStrength * 100) / 100,
          });
        }
      }

      // Sort connections: direct (higher strength) first, then indirect
      connections.sort((a, b) => b.strength - a.strength);

      // ── Strategy links (expanded to cover indirect connections too) ──
      const strategyLinks: StrategyLink[] = [];
      const allConnectedInternalIds = new Set(connections.map((c) => c.internal_entity_id));

      if (strategyRec) {
        // Check perspectives
        for (const persp of strategyRec.perspectives ?? []) {
          const perspectiveLinked = new Set<string>();
          for (const action of persp.actions ?? []) {
            const actionEntityId = action.entity_id;
            if (actionEntityId && allConnectedInternalIds.has(actionEntityId) && !perspectiveLinked.has(persp.name)) {
              perspectiveLinked.add(persp.name);
              const isDirect = connections.find((c) => c.internal_entity_id === actionEntityId)?.strength ?? 0 > 0.3;
              strategyLinks.push({
                perspective_name: persp.name,
                relevance: isDirect
                  ? `Directly supports "${action.text}" in ${persp.name}`
                  : `Indirectly impacts "${action.text}" in ${persp.name}`,
              });
            }
          }
        }

        // Check micro tactics
        for (const tactic of strategyRec.micro_tactics ?? []) {
          if (allConnectedInternalIds.has(tactic.entity_id)) {
            strategyLinks.push({
              tactic_title: tactic.title,
              relevance: `Informs tactic: "${tactic.title}"`,
            });
          }
        }

        // Check infrastructure map
        for (const comp of strategyRec.infrastructure_map?.core_components ?? []) {
          if (allConnectedInternalIds.has(comp.entity_id)) {
            strategyLinks.push({
              infrastructure_component: comp.entity_name,
              relevance: `Connected to infrastructure: ${comp.entity_name} (${comp.role})`,
            });
          }
        }
      }

      // ── Cross-context insights (expanded scope) ──
      const relatedInsights = crossContextInsights
        .filter((cci) =>
          (cci.external_entities ?? []).includes(entityId) ||
          connections.some((c) => (cci.internal_entities ?? []).includes(c.internal_entity_id))
        )
        .map((cci) => cci.insight);

      return {
        external_entity_id: entityId,
        external_entity_name: entity.name,
        ring,
        connections,
        strategy_links: strategyLinks,
        cross_context_insights: relatedInsights,
      };
    },
    [externalEntities, internalEntities, bridgeEdges, entityRingMap, strategyRec, crossContextInsights, entityLookup, adjacencyIndex]
  );

  // ── Compute summary ──

  const summary: RadarSummary = useMemo(() => {
    const byCategory: Record<string, number> = {};
    const byAuthority: Record<string, number> = {};

    for (const e of externalEntities) {
      const prov = e.provenance as Record<string, unknown> | null;
      const cat = (prov?.category as string) ?? "pattern";
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;

      const auth = (e.authority_level ?? "unverified") as string;
      byAuthority[auth] = (byAuthority[auth] ?? 0) + 1;
    }

    // Coverage score: multi-dimensional assessment of external landscape quality
    // Components: quantity ratio, bridge coverage, authority quality, category diversity
    const quantityRatio = internalEntities.length > 0
      ? Math.min(1, (externalEntities.length / internalEntities.length) * 2)
      : 0;
    // Bridge coverage: what % of externals have bridges to internal
    const bridgedCount = externalEntities.filter((e) => {
      const ring = entityRingMap.get(e.entity_id);
      return ring === "direct";
    }).length;
    const bridgeCoverage = externalEntities.length > 0
      ? bridgedCount / externalEntities.length
      : 0;
    // Authority quality: % with high or moderate authority
    const qualityCount = externalEntities.filter((e) =>
      e.authority_level === "high" || e.authority_level === "moderate"
    ).length;
    const authorityQuality = externalEntities.length > 0
      ? qualityCount / externalEntities.length
      : 0;
    // Category diversity: how many of the 7 categories are represented
    const categoryDiversity = Math.min(1, Object.keys(byCategory).length / 5);

    // Weighted composite: quantity 25%, bridges 30%, authority 25%, diversity 20%
    const coverageScore = Math.min(100, Math.round(
      (quantityRatio * 25 + bridgeCoverage * 30 + authorityQuality * 25 + categoryDiversity * 20)
    ));

    const researchProvenance = parsedSynth?.research_provenance as Record<string, unknown> | undefined;
    const lastResearchAt = researchProvenance?.timestamp as string | undefined ?? radarData?.updated_at ?? null;

    // Tier counts
    let embeddedCount = 0;
    let observatoryCount = 0;
    let promotionCandidateCount = 0;
    for (const e of externalEntities) {
      const tier = getTier(e);
      if (tier === "embedded") embeddedCount++;
      else {
        observatoryCount++;
        // Promotion eligible: has at least one bridge or non-empty connection_hints
        const eProv = e.provenance as Record<string, unknown> | null;
        const hints = (eProv?.connection_hints as string[]) ?? [];
        const hasBridge = bridgeEdges.some(
          (edge) => edge.source_entity_id === e.entity_id || edge.target_entity_id === e.entity_id
        );
        if (hasBridge || hints.length > 0) promotionCandidateCount++;
      }
    }

    return {
      total_external: externalEntities.length,
      total_internal: internalEntities.length + conceptualEntities.length,
      by_category: byCategory,
      by_authority: byAuthority,
      bridge_count: bridgeEdges.length,
      signal_count: radarData?.signals?.length ?? 0,
      last_research_at: lastResearchAt,
      coverage_score: coverageScore,
      embedded_count: embeddedCount,
      observatory_count: observatoryCount,
      promotion_candidate_count: promotionCandidateCount,
    };
  }, [externalEntities, internalEntities, bridgeEdges, parsedSynth, radarData, entityRingMap, getTier]);

  const coverageBreakdown: CoverageBreakdown = useMemo(() => {
    const byCategory = new Set<string>();
    for (const e of externalEntities) {
      const prov = e.provenance as Record<string, unknown> | null;
      byCategory.add((prov?.category as string) ?? "pattern");
    }

    const quantityRatio = internalEntities.length > 0
      ? Math.min(1, (externalEntities.length / internalEntities.length) * 2)
      : 0;
    const bridgedCount = externalEntities.filter((e) => entityRingMap.get(e.entity_id) === "direct").length;
    const bridgeCoverage = externalEntities.length > 0 ? bridgedCount / externalEntities.length : 0;
    const qualityCount = externalEntities.filter((e) =>
      e.authority_level === "high" || e.authority_level === "moderate"
    ).length;
    const authorityQuality = externalEntities.length > 0 ? qualityCount / externalEntities.length : 0;
    const categoryDiversity = Math.min(1, byCategory.size / 7);

    return {
      quantity_ratio: quantityRatio,
      bridge_coverage: bridgeCoverage,
      authority_quality: authorityQuality,
      category_diversity: categoryDiversity,
    };
  }, [externalEntities, internalEntities, entityRingMap]);

  // ── Temporal Intelligence (v2) ──

  const temporalIntelligence: TemporalIntelligence | null = useMemo(() => {
    if (externalEntities.length === 0) return null;
    const existingSnapshots = radarV2?.temporal?.coverage_trajectory?.snapshots;
    return computeTemporalIntelligence({
      signals: radarData?.signals ?? [],
      externalEntities,
      internalEntities,
      bridgeEdges,
      coverageScore: summary.coverage_score,
      existingSnapshots,
      schedule: radarData?.schedule ?? null,
    });
  }, [externalEntities, internalEntities, bridgeEdges, radarData, radarV2, summary.coverage_score]);

  // ── Coverage Improvement Recommendations (v2) ──

  const coverageImprovements: CoverageImprovementRec[] = useMemo(() => {
    if (externalEntities.length === 0 && internalEntities.length === 0) return [];
    return computeCoverageImprovements({
      externalEntities,
      internalEntities,
      edges,
      coverageScore: summary.coverage_score,
      coverageBreakdown,
    });
  }, [externalEntities, internalEntities, edges, summary.coverage_score, coverageBreakdown]);

  // ── Cross-Layer Analysis (v2 — 3-Layer KG) ──

  const crossLayerAnalysis = useMemo(() => {
    return radarV2?.cross_layer_analysis ?? null;
  }, [radarV2]);

  const compositions = useMemo(() => {
    return radarV2?.compositions ?? [];
  }, [radarV2]);

  // ── Knowledge Stack: Floating entities (disconnected, zero edges) ──

  const floatingEntities: Entity[] = useMemo(() => {
    const connectedIds = new Set<string>();
    for (const edge of edges) {
      connectedIds.add(edge.source_entity_id);
      connectedIds.add(edge.target_entity_id);
    }
    return externalEntities.filter(
      (e) => !connectedIds.has(e.entity_id) && !connectedIds.has(e.id)
    );
  }, [externalEntities, edges]);

  // ── Knowledge Stack: Epistemic type map (heuristic classification) ──

  const epistemicTypeMap: Map<string, EpistemicNodeType> = useMemo(() => {
    const map = new Map<string, EpistemicNodeType>();
    const continuationEntityIds = new Set<string>();
    for (const cs of continuationSignals) {
      // Continuation signals reference entities via follow_up_queries text matching
      // and description text — use description keywords to match entity names
      const desc = (cs.description ?? "").toLowerCase();
      for (const e of entities) {
        if (desc.includes(e.name.toLowerCase())) {
          continuationEntityIds.add(e.entity_id);
        }
      }
    }

    for (const e of entities) {
      const prov = e.provenance as Record<string, unknown> | null;
      const sourceType = prov?.source_type as string | undefined;
      const authority = e.authority_level ?? "unverified";
      const category = (prov?.category as string) ?? e.entity_category ?? "";
      const isHypothesis = prov?.is_hypothesis as boolean | undefined;

      let type: EpistemicNodeType = "claim"; // default

      if (sourceType === "web_search" && (authority === "high" || authority === "moderate")) {
        type = "evidence";
      } else if (category === "framework" || category === "pattern" || e.entity_category === "process") {
        type = "pattern";
      } else if (category === "analogy" || isHypothesis) {
        type = "hypothesis";
      } else if (category === "competitor" || category === "actor" || e.entity_type?.toLowerCase().includes("actor")) {
        type = "actor";
      } else if (continuationEntityIds.has(e.entity_id)) {
        type = "question";
      }

      map.set(e.entity_id, type);
    }
    return map;
  }, [entities, continuationSignals]);

  // ── Knowledge Stack: Credibility map ──

  const credibilityMap: Map<string, SourceCredibility> = useMemo(() => {
    const map = new Map<string, SourceCredibility>();
    const authorityScores: Record<string, number> = {
      high: 0.95, moderate: 0.7, low: 0.4, unverified: 0.2,
    };
    const freshnessScores: Record<string, number> = {
      current: 1.0, recent: 0.8, dated: 0.5, unknown: 0.3,
    };

    for (const e of entities) {
      const prov = e.provenance as Record<string, unknown> | null;
      const citationUrls = prov?.citation_urls as string[] | undefined;
      const temporalFreshness = (prov?.temporal_freshness as string) ?? "unknown";

      const source_authority = authorityScores[e.authority_level ?? "unverified"] ?? 0.2;
      const claim_corroboration = Math.min(1, (citationUrls?.length ?? 0) / 3);
      const recency = freshnessScores[temporalFreshness] ?? 0.3;
      const effective_confidence =
        source_authority * 0.4 + claim_corroboration * 0.35 + recency * 0.25;

      map.set(e.entity_id, { source_authority, claim_corroboration, recency, effective_confidence });
    }
    return map;
  }, [entities]);

  // ── Knowledge Stack: Stack counts (Sources → Atoms → Connections → Insights pipeline) ──

  const stackCounts: KnowledgeStackCounts = useMemo(() => {
    // Sources: unique citation URLs across all entities
    const sourceUrls = new Set<string>();
    let credSum = 0;
    let credCount = 0;
    for (const e of externalEntities) {
      const prov = e.provenance as Record<string, unknown> | null;
      const urls = prov?.citation_urls as string[] | undefined;
      const sourceUrl = prov?.source_url as string | undefined;
      if (urls) for (const u of urls) sourceUrls.add(u);
      if (sourceUrl) sourceUrls.add(sourceUrl);
      const cred = credibilityMap.get(e.entity_id);
      if (cred) { credSum += cred.effective_confidence; credCount++; }
    }

    // Atoms: all entities
    const verifiedCount = entities.filter(
      (e) => e.authority_level === "high" || e.authority_level === "moderate"
    ).length;

    // Connections: typed vs floating
    const typedEdges = edges.filter((e) => e.relationship_type && e.relationship_type.trim() !== "").length;

    // Insights: from synthesis
    const insightCount =
      crossContextInsights.length +
      hiddenSignals.filter((s) => (s.trajectory_impact ?? 0) >= 7).length;
    const highImpactInsights =
      crossContextInsights.filter((i) => i.confidence === "high").length;

    return {
      sources: {
        total: Math.max(sourceUrls.size, externalEntities.length > 0 ? 1 : 0),
        avg_credibility: credCount > 0 ? credSum / credCount : 0,
      },
      atoms: { total: entities.length, verified: verifiedCount },
      connections: { typed: typedEdges, floating: floatingEntities.length },
      insights: { total: insightCount, high_impact: highImpactInsights },
    };
  }, [entities, externalEntities, edges, crossContextInsights, hiddenSignals, floatingEntities, credibilityMap]);

  // ── Knowledge Stack: Stack health ──

  const stackHealth: StackHealth = useMemo(() => {
    const source_diversity = coverageBreakdown.category_diversity * 10;
    const avg_credibility = stackCounts.sources.avg_credibility;
    const maxPossibleEdges = entities.length > 1
      ? (entities.length * (entities.length - 1)) / 2
      : 1;
    const connection_density = Math.min(1, stackCounts.connections.typed / maxPossibleEdges);
    const insight_yield = stackCounts.atoms.total > 0
      ? stackCounts.insights.total / stackCounts.atoms.total
      : 0;

    return { source_diversity, avg_credibility, connection_density, insight_yield };
  }, [coverageBreakdown, stackCounts, entities.length]);

  // ── Knowledge Stack: Graph clusters ──

  const graphClusters: LandscapeCluster[] = useMemo(() => {
    // Use LLM-generated clusters if available and they cover most entities
    if (radarV2?.landscape_clusters && radarV2.landscape_clusters.length > 0) {
      const coveredIds = new Set(radarV2.landscape_clusters.flatMap((c) => c.entity_ids));
      // If LLM clusters cover >60% of entities, use them (with colors)
      if (coveredIds.size > entities.length * 0.6) {
        return radarV2.landscape_clusters.map((c, i) => ({
          ...c,
          color: c.color ?? CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
        }));
      }
      // Otherwise supplement with auto-clusters for uncovered entities
      const llmClusters = radarV2.landscape_clusters.map((c, i) => ({
        ...c,
        color: c.color ?? CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
      }));
      const uncovered = entities.filter((e) => !coveredIds.has(e.entity_id));
      if (uncovered.length > 0) {
        const autoMap = new Map<string, string[]>();
        for (const e of uncovered) {
          const key = clusterKeyForEntity(e);
          if (!autoMap.has(key)) autoMap.set(key, []);
          autoMap.get(key)!.push(e.entity_id);
        }
        let autoIdx = llmClusters.length;
        for (const [key, eids] of autoMap) {
          llmClusters.push({
            id: `cluster_auto_${key}`,
            label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            entity_ids: eids,
            signal_strength: eids.length / Math.max(entities.length, 1),
            color: CLUSTER_PALETTE[autoIdx++ % CLUSTER_PALETTE.length],
          });
        }
      }
      return llmClusters;
    }
    // Fallback: auto-compute from ALL entities (not just external)
    const clusterMap = new Map<string, string[]>();
    for (const e of entities) {
      const key = clusterKeyForEntity(e);
      if (!clusterMap.has(key)) clusterMap.set(key, []);
      clusterMap.get(key)!.push(e.entity_id);
    }
    let colorIdx = 0;
    return Array.from(clusterMap.entries()).map(([key, entityIds]) => ({
      id: `cluster_${key}`,
      label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      entity_ids: entityIds,
      signal_strength: entityIds.length / Math.max(entities.length, 1),
      color: CLUSTER_PALETTE[colorIdx++ % CLUSTER_PALETTE.length],
    }));
  }, [radarV2, entities]);

  // ── Knowledge Stack: Agent fleet (derived from focus areas + continuation signals) ──

  const agentFleet: ResearchAgent[] = useMemo(() => {
    const agents: ResearchAgent[] = [];
    const focusAreas = radarData?.schedule?.focus_areas ?? [];

    // Each focus area becomes an agent
    for (const area of focusAreas) {
      const matchingEntities = externalEntities.filter((e) => {
        const prov = e.provenance as Record<string, unknown> | null;
        return (prov?.discovered_by_agent as string) === area;
      });
      agents.push({
        id: `agent_focus_${area.replace(/\s+/g, "_").toLowerCase()}`,
        name: area,
        focus_areas: [area],
        status: researchLoading ? "running" : "idle",
        last_run_at: radarData?.schedule?.last_run_at ?? null,
        findings_count: matchingEntities.length,
        entity_ids: matchingEntities.map((e) => e.entity_id),
        derived_from: "focus_area",
        callsign: generateCallsign(area, agents.length),
        specialty: `${area} research`,
        signals_today: matchingEntities.length,
      });
    }

    // Each high-priority continuation signal becomes a potential agent
    for (const cs of continuationSignals) {
      if (cs.priority === "critical" || cs.priority === "high") {
        const csName = (cs.description ?? "Unknown signal").slice(0, 50);
        agents.push({
          id: `agent_cs_${cs.type ?? "gap"}_${agents.length}`,
          name: csName,
          focus_areas: (cs.follow_up_queries as string[] | undefined) ?? [],
          status: "idle",
          last_run_at: null,
          findings_count: 0,
          entity_ids: [],
          derived_from: "continuation_signal",
          source_trigger_id: cs.type,
          callsign: generateCallsign(`cs_${cs.type}`, agents.length),
          specialty: cs.type.replace(/_/g, " "),
          signals_today: 0,
        });
      }
    }

    // ── Sub-objective agents (from synthesis_data.suggested_objectives) ──
    const suggestedObjectives = parsedSynth?.suggested_objectives ?? [];
    for (const obj of suggestedObjectives) {
      const chain = obj.causal_chain ?? [];
      const srcEntityId = obj.source_entity_id;
      const chainEntityIds = new Set<string>(chain);
      if (srcEntityId) chainEntityIds.add(srcEntityId);

      const matchingEntities = entities.filter((e) =>
        chainEntityIds.has(e.entity_id) || chainEntityIds.has(e.id),
      );

      agents.push({
        id: `agent_so_${obj.key}`,
        name: obj.title,
        focus_areas: [obj.metric_name ?? obj.title],
        status: "idle",
        last_run_at: null,
        findings_count: matchingEntities.length,
        entity_ids: matchingEntities.map((e) => e.entity_id),
        derived_from: "sub_objective",
        callsign: generateCallsign(obj.key, agents.length),
        specialty: formatObjectiveSpecialty(obj),
        source_objective_id: obj.key,
        signals_today: matchingEntities.length,
      });
    }

    // ── Goal-tracking agents (from improvement_goals with parent_goal_id) ──
    const leafGoals = goals.filter((g) => g.parent_goal_id !== null);
    for (const goal of leafGoals) {
      const entityIds: string[] = [];
      agents.push({
        id: `agent_goal_${goal.id}`,
        name: goal.title,
        focus_areas: [goal.metric_name],
        status: "idle",
        last_run_at: null,
        findings_count: 0,
        entity_ids: entityIds,
        derived_from: "goal_tracking",
        callsign: generateCallsign(goal.id, agents.length),
        specialty: formatGoalSpecialty(goal),
        source_goal_id: goal.id,
        signals_today: 0,
      });
    }

    return agents;
  }, [externalEntities, radarData, researchLoading, continuationSignals, parsedSynth, goals, entities]);

  // ── Entity verdict weights (v2 — user feedback learning) ──

  const entityVerdictWeightsMap: Map<string, EntityVerdictWeight> = useMemo(() => {
    const weights = new Map<string, EntityVerdictWeight>();
    const verdictEntries = radarV2?.entity_verdict_weights;
    if (verdictEntries) {
      for (const v of verdictEntries) {
        weights.set(v.entity_id, v);
      }
    }
    return weights;
  }, [radarV2]);

  // ── Signals ──

  const signals: IntelligenceSignal[] = useMemo(() => {
    return radarData?.signals ?? [];
  }, [radarData]);

  const priorityDecisions: PriorityDecision[] = useMemo(() => {
    const actionableSignals = signals.filter(
      (s) => s.status !== "dismissed" && s.status !== "resolved"
    );
    if (actionableSignals.length === 0) return [];

    const scored = actionableSignals.map((s) => {
      const analysis = connectionAnalysis(s.entity_id);
      const ageHours = Math.max(0, (Date.now() - new Date(s.detected_at).getTime()) / (1000 * 60 * 60));

      const severityWeight = s.severity === "high" ? 60 : s.severity === "medium" ? 35 : 15;
      const statusWeight =
        s.status === "escalated" ? 25 :
        s.status === "investigating" ? 15 :
        10;
      const recencyWeight = Math.max(0, 1 - Math.min(1, ageHours / (24 * 14))) * 25;
      const blastWeight = Math.min(15, s.related_internal_entities.length * 4);
      const strategyWeight = Math.min(15, (analysis?.strategy_links.length ?? 0) * 4);
      const bridgeBonus = s.type === "new_bridge" ? 10 : 0;

      // v2: User feedback influence — verdict weights adjust urgency
      const baseUrgency = severityWeight + statusWeight + recencyWeight + blastWeight + strategyWeight + bridgeBonus;
      const urgencyScore = Math.round(
        applyVerdictBonus(baseUrgency, s.entity_id, entityVerdictWeightsMap)
      );

      let actionLabel = "Investigate and classify impact";
      if (s.type === "new_bridge") actionLabel = "Validate bridge and integrate into strategy";
      else if (s.type === "authority_change") actionLabel = "Reassess authority and affected assumptions";
      else if (s.type === "confidence_shift") actionLabel = "Review confidence shift impact";
      else if (s.type === "new_entity") actionLabel = "Triage relevance and potential bridge";
      else if (s.type === "entity_removed") actionLabel = "Assess dependency and replace missing intel";
      else if (s.type === "new_source") actionLabel = "Verify source quality and incorporate evidence";

      const connectionCount = analysis?.connections.length ?? 0;
      const strategyCount = analysis?.strategy_links.length ?? 0;
      const rationale =
        connectionCount > 0 || strategyCount > 0
          ? `${connectionCount} internal connection${connectionCount === 1 ? "" : "s"}, ${strategyCount} strategy link${strategyCount === 1 ? "" : "s"}`
          : "No mapped connections yet; requires triage";

      return { s, urgencyScore, actionLabel, rationale };
    });

    // keep strongest signal per entity to reduce noise
    const byEntity = new Map<string, typeof scored[number]>();
    for (const item of scored) {
      const prev = byEntity.get(item.s.entity_id);
      if (!prev || item.urgencyScore > prev.urgencyScore) byEntity.set(item.s.entity_id, item);
    }

    const deduped = [...byEntity.values()].sort((a, b) => b.urgencyScore - a.urgencyScore).slice(0, 9);

    return deduped.map((item, idx) => {
      const bucket: PriorityDecision["bucket"] =
        item.urgencyScore >= 105 || idx < 2 ? "now" :
        item.urgencyScore >= 80 ? "next" : "watch";

      return {
        id: `decision_${item.s.id}`,
        signal_id: item.s.id,
        entity_id: item.s.entity_id,
        entity_name: item.s.entity_name,
        bucket,
        urgency_score: item.urgencyScore,
        action_label: item.actionLabel,
        rationale: item.rationale,
        related_internal_entities: item.s.related_internal_entities,
        detected_at: item.s.detected_at,
      };
    });
  }, [signals, connectionAnalysis, entityVerdictWeightsMap]);

  // ── Research trigger ──

  const triggerResearch = useCallback(
    async (depth?: string, focusAreas?: string[]) => {
      if (researchLoading) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setResearchLoading(true);
      setResearchError(null);

      try {
        // Use orchestrate endpoint with research-only mode if available,
        // otherwise use the full pipeline which includes research
        const payload: Record<string, unknown> = {
          spaceId: space.id,
          researchOnly: true,
          researchDepth: depth ?? "standard",
        };
        // Forward focus_areas to improve research targeting
        if (focusAreas && focusAreas.length > 0) {
          payload.focus_areas = focusAreas;
        }
        const res = await fetch("/api/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const result = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(result.error ?? `HTTP ${res.status}`);
        }

        // Capture result counts for UI feedback
        setResearchResult({
          entitiesCreated: result.entitiesCreated ?? 0,
          edgesCreated: (result.edgesCreated ?? 0) + (result.bridgesCreated ?? 0) + (result.hintBridgesCreated ?? 0),
          bridgesCreated: (result.bridgesCreated ?? 0) + (result.hintBridgesCreated ?? 0),
          searchesPerformed: result.searchesPerformed ?? 0,
        });
        setResearchLoading(false);
        router.refresh();

        // Auto-dismiss result after 8 seconds
        setTimeout(() => setResearchResult(null), 8000);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setResearchError((err as Error).message);
        setResearchLoading(false);
      }
    },
    [space.id, researchLoading, router]
  );

  // ── Schedule management ──

  const schedule: ResearchSchedule | null = radarData?.schedule ?? null;

  const updateSchedule = useCallback(
    async (updates: Partial<ResearchSchedule>) => {
      try {
        const res = await fetch("/api/pipeline/research-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spaceId: space.id, schedule: updates }),
        });
        if (!res.ok) throw new Error("Failed to update schedule");
        router.refresh();
      } catch (err) {
        console.warn("Schedule update failed:", err);
      }
    },
    [space.id, router]
  );

  // ── Auto-trigger scheduled research if overdue ──

  const scheduleTriggerRef = useRef(false);
  useEffect(() => {
    if (scheduleTriggerRef.current) return;
    if (!schedule?.enabled || !schedule.next_run_at) return;

    const nextRun = new Date(schedule.next_run_at).getTime();
    if (Date.now() > nextRun) {
      scheduleTriggerRef.current = true;
      triggerResearch(schedule.depth, schedule.focus_areas);
    }
  }, [schedule]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Strategy bridge: computed values ──

  const escalatedSignalCount = useMemo(() => {
    return signals.filter(
      (s) => s.status === "escalated" || s.severity === "high"
    ).length;
  }, [signals]);

  const { strategyRefreshRecommended, strategyRefreshReason } = useMemo(() => {
    // Condition 1: 2+ escalated/high signals
    const escalatedOrHigh = signals.filter(
      (s) => s.status === "escalated" || s.severity === "high"
    );
    if (escalatedOrHigh.length >= 2) {
      return {
        strategyRefreshRecommended: true,
        strategyRefreshReason: `${escalatedOrHigh.length} escalated signals detected`,
      };
    }

    // Condition 2: Any high-severity signal still active
    const activeHighSeverity = signals.filter(
      (s) =>
        s.severity === "high" &&
        (!s.status || s.status === "active" || s.status === "escalated")
    );
    if (activeHighSeverity.length > 0) {
      return {
        strategyRefreshRecommended: true,
        strategyRefreshReason: `${activeHighSeverity.length} high-severity signal${activeHighSeverity.length > 1 ? "s" : ""} still active`,
      };
    }

    // Condition 3: New bridge connections detected in recent signals
    const newBridges = signals.filter((s) => s.type === "new_bridge");
    if (newBridges.length > 0) {
      return {
        strategyRefreshRecommended: true,
        strategyRefreshReason: `${newBridges.length} new bridge connection${newBridges.length > 1 ? "s" : ""} detected`,
      };
    }

    return { strategyRefreshRecommended: false, strategyRefreshReason: null };
  }, [signals]);

  // ── Strategy refresh trigger ──

  const [strategyRefreshLoading, setStrategyRefreshLoading] = useState(false);
  const [strategyRefreshResult, setStrategyRefreshResult] = useState<StrategyRefreshResult | null>(null);

  const triggerStrategyRefresh = useCallback(async () => {
    if (strategyRefreshLoading) return;
    setStrategyRefreshLoading(true);
    setStrategyRefreshResult(null);

    // Collect the signals that are driving the recommendation
    const influencingSignals = signals.filter(
      (s) =>
        s.status === "escalated" ||
        s.severity === "high" ||
        (s.severity === "medium" && (!s.status || s.status === "active")) ||
        s.type === "new_bridge"
    );

    try {
      const res = await fetch("/api/pipeline/strategy-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId: space.id,
          influencingSignals: influencingSignals.map((s) => ({
            id: s.id,
            type: s.type,
            severity: s.severity,
            status: s.status ?? "active",
            entity_id: s.entity_id,
            entity_name: s.entity_name,
            detected_at: s.detected_at,
            related_internal_entities: s.related_internal_entities,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      setStrategyRefreshResult({
        success: true,
        strategy_count: data.strategy_count,
        top_strategy: data.top_strategy,
        confidence: data.confidence,
        influencing_signals: influencingSignals,
      });
      setStrategyRefreshLoading(false);
      router.refresh();
    } catch (err) {
      setStrategyRefreshResult({
        success: false,
        error: (err as Error).message,
        influencing_signals: influencingSignals,
      });
      setStrategyRefreshLoading(false);
    }
  }, [space.id, strategyRefreshLoading, signals, router]);

  // ── Signal status management ──

  const updateSignalStatus = useCallback(
    async (signalId: string, status: SignalStatus, note?: string) => {
      try {
        // Compute implicit verdict from status change (feedback learning)
        let verdictPayload: { signal_verdicts: unknown[]; entity_verdict_weights: unknown[] } | undefined;
        const verdict = computeVerdictFromStatus(status);
        if (verdict) {
          const signal = signals.find((s) => s.id === signalId);
          if (signal) {
            const existingVerdicts = radarV2?.signal_verdicts ?? [];
            const updatedVerdicts = recordVerdict({
              existingVerdicts,
              signalId,
              entityId: signal.entity_id,
              verdict,
              note,
            });
            const updatedWeights = computeEntityVerdictWeights(updatedVerdicts);
            verdictPayload = {
              signal_verdicts: updatedVerdicts,
              entity_verdict_weights: updatedWeights,
            };
          }
        }

        // Single atomic request — signal status + verdict update together
        const res = await fetch("/api/pipeline/research-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId: space.id,
            signalUpdate: { signalId, status, note },
            ...(verdictPayload ? { verdictUpdate: verdictPayload } : {}),
          }),
        });
        if (!res.ok) throw new Error("Failed to update signal status");
        router.refresh();
      } catch (err) {
        console.warn("Signal status update failed:", err);
      }
    },
    [space.id, router, signals, radarV2]
  );

  // ── Suggested bridges (Task 4.3) ──

  const suggestedBridges: SuggestedBridge[] = useMemo(() => {
    // Find landscape entities (external with NO bridge edges to internal)
    // Check both entity_id and UUID since edges may use either format
    const bridgedExternalEntityIds = new Set<string>();
    for (const edge of bridgeEdges) {
      for (const e of externalEntities) {
        if (edge.source_entity_id === e.entity_id || edge.source_entity_id === e.id ||
            edge.target_entity_id === e.entity_id || edge.target_entity_id === e.id) {
          bridgedExternalEntityIds.add(e.entity_id);
        }
      }
    }

    const landscapeEntities = externalEntities.filter(
      (e) => !bridgedExternalEntityIds.has(e.entity_id),
    );

    const suggestions: SuggestedBridge[] = [];

    for (const ext of landscapeEntities) {
      const extText = `${ext.name} ${ext.description ?? ""}`;

      let bestMatch: { entity: Entity; score: number; terms: string[] } | null = null;

      for (const int of internalEntities) {
        const intText = `${int.name} ${int.description ?? ""}`;
        const { score, sharedTerms } = wordOverlapScore(extText, intText);

        if (score > 0.15 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { entity: int, score, terms: sharedTerms };
        }
      }

      if (bestMatch) {
        suggestions.push({
          externalEntity: ext,
          internalEntity: bestMatch.entity,
          score: Math.round(bestMatch.score * 100) / 100,
          sharedTerms: bestMatch.terms,
        });
      }
    }

    // Sort by score descending, cap at 10
    return suggestions.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [externalEntities, internalEntities, bridgeEdges]);

  // ── Create bridge edge (Task 4.3) ──

  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const createBridgeEdge = useCallback(
    async (externalEntityId: string, internalEntityId: string) => {
      setBridgeError(null);
      try {
        const res = await fetch("/api/edges/bridge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            space_id: space.id,
            source_entity_id: externalEntityId,
            target_entity_id: internalEntityId,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          setBridgeError(err.error ?? `HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (data.already_exists) {
          setBridgeError("Bridge already exists");
          return;
        }
        router.refresh();
      } catch (err) {
        setBridgeError((err as Error).message);
      }
    },
    [space.id, router],
  );

  // ── Update entity authority (Task 4.4) ──

  const updateEntityAuthority = useCallback(
    async (entityDbId: string, level: "high" | "moderate" | "low" | "unverified") => {
      try {
        const res = await fetch(`/api/entities/${entityDbId}/authority`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authority_level: level }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (err) {
        console.warn("Update entity authority failed:", err);
      }
    },
    [router],
  );

  // ── Tier promotion ──

  const promoteTier = useCallback(
    async (entityId: string, newTier: "embedded" | "observatory") => {
      const entity = externalEntities.find((e) => e.entity_id === entityId);
      if (!entity) return;
      try {
        const prov = { ...((entity.provenance as Record<string, unknown>) ?? {}), intelligence_tier: newTier, intelligence_tier_manual: newTier };
        // Use the entity's DB id (UUID) if available, fall back to entity_id
        const dbId = (entity as Record<string, unknown>).id as string | undefined;
        if (dbId) {
          await fetch(`/api/entities/${dbId}/authority`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provenance: prov }),
          });
        }
        router.refresh();
      } catch (err) {
        console.warn("Promote tier failed:", err);
      }
    },
    [externalEntities, router],
  );

  // ── Cleanup ──

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    // Data
    externalEntities,
    internalEntities,
    bridgeEntities,
    conceptualEntities,
    bridgeEdges,
    internalEdges,
    externalEdges,
    crossContextInsights,
    hiddenSignals,
    continuationSignals,
    summary,
    signals,
    radarData,

    // Reasoning-layer data (wired for EntityInspector reasoning tab — expose
    // full parsed synthesisData so consumers can resolve axiom backlinks,
    // convergence membership, inversions targeting a given entity, and
    // expansion axioms for expanded entities without re-parsing.)
    synthesisData: parsedSynth,
    axioms: parsedSynth?.axioms,
    insightConvergences: parsedSynth?.insight_convergences,
    assumptionInversions: parsedSynth?.assumption_inversions,
    expansionAxioms: parsedSynth?.expansion_axioms,

    // v2 data
    radarV2,
    temporalIntelligence,
    coverageImprovements,
    crossLayerAnalysis,
    compositions,

    // Computed
    entityRingMap,
    filteredExternalEntities,
    connectionAnalysis,
    suggestedBridges,
    priorityDecisions,
    coverageBreakdown,

    // Filters
    filters,
    setFilters,

    // Actions
    triggerResearch,
    researchLoading,
    researchError,
    researchResult,
    dismissResearchResult: useCallback(() => setResearchResult(null), []),
    createBridgeEdge,
    updateEntityAuthority,

    // Signal actions
    updateSignalStatus,

    // Strategy bridge
    triggerStrategyRefresh,
    strategyRefreshLoading,
    strategyRefreshResult,
    escalatedSignalCount,
    strategyRefreshRecommended,
    strategyRefreshReason,

    // Schedule
    schedule,
    updateSchedule,

    // Selection
    selectedEntityId,
    setSelectedEntityId,

    // Intelligence tiers
    getTier,
    promoteTier,

    // Feature availability
    hasExternalData: externalEntities.length > 0,

    // Knowledge Stack (v3)
    stackCounts,
    stackHealth,
    agentFleet,
    floatingEntities,
    epistemicTypeMap,
    credibilityMap,
    graphClusters,
  };
}
