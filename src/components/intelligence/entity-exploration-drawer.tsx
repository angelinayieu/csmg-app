"use client";

import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  X,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Link,
  CheckCircle2,
  Layers,
  Search,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity, Edge } from "@/types";
import type { AuthorityLevel } from "@/types/intelligence";
import { AUTHORITY_CONFIG } from "@/types/intelligence";
import { cleanEntityName } from "@/components/intelligence/orbital-graph";

// ── Props ──

interface EntityExplorationDrawerProps {
  entityId: string | null;
  entities: Entity[];
  edges: Edge[];
  onClose: () => void;
  onNavigate: (entityId: string) => void;
  onAuthorityChange: (entityUuid: string, level: "high" | "moderate" | "low" | "unverified") => Promise<void>;
}

// ── Provenance shape (Json column -- loosely typed) ──

interface EntityProvenance {
  source_url?: string;
  citation_urls?: string[];
  detection_method?: string;
  analogous_precedent?: string;
  signal_type?: string;
  risk_signal_flags?: string[];
  connection_hints?: string[];
  temporal_freshness?: string;
  relevance?: string;
  source_detail?: string;
  relevance_score?: number;
  confidence_basis?: string;
  category?: string;
  source_type?: string;
  mechanism?: string;
  sub_components?: Array<{ name: string; role: string }>;
  causal_upstream?: string[];
  causal_downstream?: string[];
  interaction_effects?: Array<{ with_entity: string; combined_effect: string; interaction_type: string }>;
  intelligence_tier?: string;
  intelligence_tier_manual?: string;
  [key: string]: unknown;
}

// ── Color maps ──

const LAYER_COLORS: Record<string, { bg: string; text: string; avatar: string; border: string }> = {
  internal:   { bg: "bg-blue-50",   text: "text-blue-700",   avatar: "bg-blue-500",   border: "border-blue-200" },
  conceptual: { bg: "bg-teal-50",   text: "text-teal-700",   avatar: "bg-teal-500",   border: "border-teal-200" },
  external:   { bg: "bg-purple-50", text: "text-purple-700", avatar: "bg-purple-500", border: "border-purple-200" },
  bridge:     { bg: "bg-amber-50",  text: "text-amber-700",  avatar: "bg-amber-500",  border: "border-amber-200" },
};

function getLayerColor(layer: string | null) {
  return LAYER_COLORS[layer ?? ""] ?? { bg: "bg-gray-50", text: "text-gray-600", avatar: "bg-gray-400", border: "border-gray-200" };
}

const LAYER_LABELS: Record<string, string> = {
  internal: "User Assets",
  conceptual: "Concept Model",
  external: "Research",
  bridge: "Bridge",
};

const RELATIONSHIP_COLORS: Record<string, { bg: string; text: string }> = {
  validates:    { bg: "bg-green-100",  text: "text-green-700" },
  challenges:   { bg: "bg-red-100",    text: "text-red-700" },
  extends:      { bg: "bg-blue-100",   text: "text-blue-700" },
  mediates:     { bg: "bg-purple-100", text: "text-purple-700" },
  risk_source:  { bg: "bg-orange-100", text: "text-orange-700" },
  supports:     { bg: "bg-green-100",  text: "text-green-700" },
  causes:       { bg: "bg-amber-100",  text: "text-amber-700" },
  correlates:   { bg: "bg-cyan-100",   text: "text-cyan-700" },
  contradicts:  { bg: "bg-red-100",    text: "text-red-700" },
  analogous:    { bg: "bg-blue-100", text: "text-blue-700" },
};

function getRelColor(type: string) {
  return RELATIONSHIP_COLORS[type] ?? { bg: "bg-gray-100", text: "text-gray-700" };
}

const SOURCE_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  paper: { bg: "bg-blue-100", text: "text-blue-700" },
  web:   { bg: "bg-blue-100",   text: "text-blue-700" },
  data:  { bg: "bg-teal-100",   text: "text-teal-700" },
  book:  { bg: "bg-amber-100",  text: "text-amber-700" },
};

function getSourceColor(type: string) {
  const key = type.toLowerCase();
  return SOURCE_TYPE_COLORS[key] ?? { bg: "bg-gray-100", text: "text-gray-700" };
}

// ── Connection type derived from edge analysis ──

interface Connection {
  entity: Entity;
  edge: Edge;
  direction: "incoming" | "outgoing";
  isBridge: boolean;
}

// ── Connection scope grouping ──

type ConnectionScope = "within_parent" | "same_layer" | "cross_layer" | "bridge";

const SCOPE_CONFIG: Record<ConnectionScope, { label: string; border: string }> = {
  within_parent: { label: "WITHIN PARENT",  border: "border-l-blue-400" },
  same_layer:    { label: "SAME LAYER",     border: "border-l-blue-400" },
  cross_layer:   { label: "CROSS-LAYER",    border: "border-l-amber-400" },
  bridge:        { label: "BRIDGE",          border: "border-l-emerald-400" },
};

// ── Collapsible section (enhanced) ──

function Section({
  id,
  title,
  count,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-200 last:border-b-0">
      <button
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between px-5 py-3 hover:bg-gray-50/80 transition-colors"
      >
        <span className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-gray-400" />
          ) : (
            <ChevronRight className="h-3 w-3 text-gray-400" />
          )}
          <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-500">
            {title}
          </span>
          {count !== undefined && (
            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-1.5 min-w-[18px] h-[16px] text-[9px] font-medium text-gray-500">
              {count}
            </span>
          )}
        </span>
      </button>
      {expanded && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

// ── Mono value display ──

function MonoValue({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("font-mono text-[14px] font-medium text-gray-900", className)}>
      {children}
    </span>
  );
}

// ── Trust color helper ──

function trustColor(value: number): string {
  if (value >= 0.7) return "text-green-600";
  if (value >= 0.4) return "text-amber-600";
  return "text-red-500";
}

// ── Main component ──

export function EntityExplorationDrawer({
  entityId,
  entities,
  edges,
  onClose,
  onNavigate,
  onAuthorityChange,
}: EntityExplorationDrawerProps) {
  // ── Internal state ──

  const [navigationStack, setNavigationStack] = useState<string[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["overview", "stats", "connections", "evidence", "decomposition"])
  );

  // Auto-expand mechanism section when mechanism data exists
  const mechanismAutoExpandRef = useRef(false);
  const [changingAuthority, setChangingAuthority] = useState(false);

  // Track whether navigate was triggered internally
  const internalNavRef = useRef(false);
  const prevEntityIdRef = useRef<string | null>(null);

  // ── Navigation logic ──

  useEffect(() => {
    if (entityId === null) {
      // Drawer closed -- reset stack
      setNavigationStack([]);
      prevEntityIdRef.current = null;
      return;
    }

    if (prevEntityIdRef.current === null) {
      // First open or external graph click -- clear stack
      if (!internalNavRef.current) {
        setNavigationStack([]);
      }
      internalNavRef.current = false;
    } else if (prevEntityIdRef.current !== entityId) {
      // Entity changed
      if (!internalNavRef.current) {
        // External trigger -- clear stack
        setNavigationStack([]);
      }
      internalNavRef.current = false;
    }

    prevEntityIdRef.current = entityId;
  }, [entityId]);

  const handleNavigate = useCallback(
    (targetId: string) => {
      if (!entityId) return;
      internalNavRef.current = true;
      setNavigationStack((prev) => [...prev, entityId]);
      onNavigate(targetId);
    },
    [entityId, onNavigate]
  );

  const handleBack = useCallback(() => {
    if (navigationStack.length === 0) return;
    const stack = [...navigationStack];
    const poppedId = stack.pop()!;
    internalNavRef.current = true;
    setNavigationStack(stack);
    onNavigate(poppedId);
  }, [navigationStack, onNavigate]);

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      const targetId = navigationStack[index];
      if (!targetId) return;
      internalNavRef.current = true;
      setNavigationStack(navigationStack.slice(0, index));
      onNavigate(targetId);
    },
    [navigationStack, onNavigate]
  );

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ── Resolve current entity ──

  const entity = useMemo(() => {
    if (!entityId) return null;
    return entities.find((e) => e.entity_id === entityId || e.id === entityId) ?? null;
  }, [entityId, entities]);

  // ── Provenance (loosely typed Json column) ──

  const provenance = useMemo<EntityProvenance>(() => {
    if (!entity?.provenance) return {};
    if (typeof entity.provenance === "object" && !Array.isArray(entity.provenance)) {
      return entity.provenance as unknown as EntityProvenance;
    }
    return {};
  }, [entity]);

  // Auto-expand mechanism section when entity has mechanism data
  const hasMechanismData = !!(
    provenance.mechanism ||
    (provenance.sub_components && provenance.sub_components.length > 0) ||
    (provenance.causal_upstream && provenance.causal_upstream.length > 0) ||
    (provenance.causal_downstream && provenance.causal_downstream.length > 0) ||
    (provenance.interaction_effects && provenance.interaction_effects.length > 0)
  );

  useEffect(() => {
    if (hasMechanismData && !mechanismAutoExpandRef.current) {
      mechanismAutoExpandRef.current = true;
      setExpandedSections((prev) => new Set([...prev, "mechanism"]));
    } else if (!hasMechanismData) {
      mechanismAutoExpandRef.current = false;
    }
  }, [hasMechanismData]);

  // ── Compute connections ──

  const connections = useMemo<Connection[]>(() => {
    if (!entityId || !entity) return [];

    return edges
      .filter(
        (edge) =>
          edge.source_entity_id === entity.entity_id ||
          edge.target_entity_id === entity.entity_id ||
          edge.source_entity_id === entity.id ||
          edge.target_entity_id === entity.id
      )
      .map((edge) => {
        const isSource =
          edge.source_entity_id === entity.entity_id ||
          edge.source_entity_id === entity.id;
        const connectedId = isSource
          ? edge.target_entity_id
          : edge.source_entity_id;
        const connectedEntity = entities.find(
          (e) => e.entity_id === connectedId || e.id === connectedId
        );
        return {
          entity: connectedEntity!,
          edge,
          direction: isSource ? ("outgoing" as const) : ("incoming" as const),
          isBridge:
            edge.knowledge_layer === "bridge" ||
            entity.knowledge_layer !== connectedEntity?.knowledge_layer,
        };
      })
      .filter((c): c is Connection => c.entity != null);
  }, [entityId, entity, entities, edges]);

  // ── Grouped connections by scope ──

  const groupedConnections = useMemo(() => {
    if (!entity) return new Map<ConnectionScope, Connection[]>();

    const groups = new Map<ConnectionScope, Connection[]>();
    groups.set("within_parent", []);
    groups.set("same_layer", []);
    groups.set("cross_layer", []);
    groups.set("bridge", []);

    for (const conn of connections) {
      if (conn.edge.knowledge_layer === "bridge" || conn.isBridge) {
        // Check if it's a true bridge (connecting different knowledge layers)
        if (entity.knowledge_layer !== conn.entity.knowledge_layer) {
          groups.get("bridge")!.push(conn);
        } else {
          groups.get("same_layer")!.push(conn);
        }
      } else if (
        // Both entities start with SC_ and share a common parent prefix
        entity.entity_id.startsWith("SC_") &&
        conn.entity.entity_id.startsWith("SC_")
      ) {
        groups.get("within_parent")!.push(conn);
      } else if (entity.knowledge_layer === conn.entity.knowledge_layer) {
        groups.get("same_layer")!.push(conn);
      } else {
        groups.get("cross_layer")!.push(conn);
      }
    }

    // Remove empty groups
    for (const [key, val] of groups) {
      if (val.length === 0) groups.delete(key);
    }

    return groups;
  }, [entity, connections]);

  const bridgeConnections = useMemo(
    () => connections.filter((c) => c.isBridge),
    [connections]
  );

  // ── Sub-component entities (SC_ children) ──

  const subComponents = useMemo(() => {
    if (!entity) return [];
    // Find entities that are sub-components of this entity
    return entities.filter((e) => {
      if (!e.entity_id.startsWith("SC_")) return false;
      const prov = (e.provenance as Record<string, unknown>) ?? {};
      return prov.source_type === "expansion_materialization" ||
        e.entity_id.includes(entity.entity_id);
    });
  }, [entity, entities]);

  // ── Breadcrumb entities ──

  const breadcrumbEntities = useMemo(() => {
    return navigationStack.map((id) =>
      entities.find((e) => e.entity_id === id || e.id === id)
    );
  }, [navigationStack, entities]);

  // ── Authority change handler ──

  const handleAuthorityClick = useCallback(
    async (level: AuthorityLevel) => {
      if (!entity || changingAuthority) return;
      setChangingAuthority(true);
      try {
        await onAuthorityChange(entity.id, level);
      } finally {
        setChangingAuthority(false);
      }
    },
    [entity, changingAuthority, onAuthorityChange]
  );

  // ── Tier badge ──

  const tierLabel = useMemo(() => {
    if (!entity) return null;
    if (entity.knowledge_layer === "external" || entity.knowledge_layer === "bridge") {
      const prov = (entity.provenance as Record<string, unknown>) ?? {};
      const tier = (prov.intelligence_tier_manual ?? prov.intelligence_tier) as string | undefined;
      if (tier === "embedded") return "Embedded";
      if (tier === "observatory") return "Observatory";
      const hasBridge = edges.some(
        (e) =>
          e.knowledge_layer === "bridge" &&
          (e.source_entity_id === entity.entity_id ||
            e.target_entity_id === entity.entity_id ||
            e.source_entity_id === entity.id ||
            e.target_entity_id === entity.id)
      );
      return hasBridge ? "Embedded" : "Observatory";
    }
    return null;
  }, [entity, edges]);

  // ── Determine if entity has a bridge edge to a "core" internal entity ──

  const bridgeTarget = useMemo(() => {
    if (!entity) return null;
    for (const conn of bridgeConnections) {
      if (conn.entity.knowledge_layer === "internal") {
        return conn;
      }
    }
    return null;
  }, [entity, bridgeConnections]);

  // ── Has sources ──

  const sourceCount = useMemo(() => {
    let count = 0;
    if (provenance.source_url) count++;
    if (provenance.citation_urls?.length) count += provenance.citation_urls.length;
    if (provenance.source_detail) count++;
    if (provenance.analogous_precedent) count++;
    return count;
  }, [provenance]);

  // ── Render nothing when closed ──

  const isOpen = entityId !== null && entity !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/10 transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          "fixed right-0 top-0 h-full w-[420px] bg-white shadow-2xl border-l border-gray-200 z-50",
          "transition-transform duration-300 ease-out",
          "flex flex-col",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {entity && (
          <>
            {/* ============================================================ */}
            {/* 1. HEADER                                                    */}
            {/* ============================================================ */}
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white">
              {/* Top row: back + avatar + title + close */}
              <div className="flex items-start gap-3 px-5 pt-4 pb-3">
                {navigationStack.length > 0 && (
                  <button
                    onClick={handleBack}
                    className="mt-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    title="Back"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}

                {/* Avatar box */}
                <div
                  className={cn(
                    "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg text-white text-[15px] font-semibold",
                    getLayerColor(entity.knowledge_layer).avatar
                  )}
                >
                  {cleanEntityName(entity).charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Type label */}
                  <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-400">
                    ATOM
                    <span className="mx-1 text-gray-300">{"/"}</span>
                    {entity.entity_type?.toUpperCase() || entity.entity_category.toUpperCase()}
                  </div>
                  {/* Entity name */}
                  <h2 className="text-[17px] font-medium text-gray-900 leading-snug mt-0.5">
                    {cleanEntityName(entity)}
                  </h2>
                </div>

                <button
                  onClick={onClose}
                  className="mt-0.5 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Breadcrumb path: layer > category > entity name */}
              <div className="flex items-center gap-1 overflow-x-auto px-5 pb-3 text-[10.5px] text-gray-400">
                {/* Layer breadcrumb */}
                <span className={cn("shrink-0", getLayerColor(entity.knowledge_layer).text)}>
                  {LAYER_LABELS[entity.knowledge_layer] || entity.knowledge_layer}
                </span>
                <span className="shrink-0 text-gray-300 mx-0.5">{"\u203A"}</span>
                {/* Category */}
                <span className="shrink-0 text-gray-500">
                  {entity.entity_type || entity.entity_category}
                </span>
                <span className="shrink-0 text-gray-300 mx-0.5">{"\u203A"}</span>
                {/* Entity name */}
                <span className="shrink-0 font-medium text-gray-700">
                  {cleanEntityName(entity)}
                </span>
              </div>

              {/* Navigation breadcrumb trail (when navigating through entities) */}
              {navigationStack.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto px-5 pb-2.5 text-[10px] text-gray-400 border-t border-gray-100 pt-2">
                  {breadcrumbEntities.map((be, i) => (
                    <React.Fragment key={navigationStack[i]}>
                      <button
                        onClick={() => handleBreadcrumbClick(i)}
                        className="shrink-0 text-blue-500 hover:text-blue-700 hover:underline transition-colors"
                      >
                        {be ? cleanEntityName(be) : "..."}
                      </button>
                      <span className="shrink-0 text-gray-300">&gt;</span>
                    </React.Fragment>
                  ))}
                  <span className="shrink-0 font-medium text-gray-600">
                    {cleanEntityName(entity)}
                  </span>
                </div>
              )}

              {/* Layer + tier + authority badges row */}
              <div className="flex items-center gap-1.5 flex-wrap px-5 pb-3">
                {entity.knowledge_layer && (
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                      getLayerColor(entity.knowledge_layer).bg,
                      getLayerColor(entity.knowledge_layer).text
                    )}
                  >
                    {LAYER_LABELS[entity.knowledge_layer] || entity.knowledge_layer}
                  </span>
                )}
                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                  {entity.entity_category}
                </span>
                {tierLabel && (
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                      tierLabel === "Embedded"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-500"
                    )}
                  >
                    {tierLabel}
                  </span>
                )}
                {entity.source_tag && (
                  <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                    {entity.source_tag}
                  </span>
                )}
                {provenance.temporal_freshness && (
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                      provenance.temporal_freshness === "current"
                        ? "bg-green-50 text-green-700"
                        : provenance.temporal_freshness === "recent"
                        ? "bg-blue-50 text-blue-700"
                        : provenance.temporal_freshness === "dated"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-gray-50 text-gray-500"
                    )}
                  >
                    {provenance.temporal_freshness}
                  </span>
                )}
              </div>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto">

              {/* ============================================================ */}
              {/* 2. BRIDGE STATUS BADGE (only if entity has bridge edges)     */}
              {/* ============================================================ */}
              {bridgeTarget && (
                <div className="mx-5 mt-4 mb-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="text-[11px] font-medium text-emerald-700">
                      Bridged to your core
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => handleNavigate(bridgeTarget.entity.entity_id || bridgeTarget.entity.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium",
                        "bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors"
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {cleanEntityName(bridgeTarget.entity)}
                    </button>
                    <span className="text-[9px] text-gray-400">
                      via {bridgeTarget.edge.relationship_type.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* 3. STATS GRID                                               */}
              {/* ============================================================ */}
              <div className="mx-5 mt-4 mb-1 grid grid-cols-3 gap-2">
                {/* Edges */}
                <div className="rounded-lg bg-gray-50 p-2.5 text-center">
                  <div className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-gray-400">
                    EDGES
                  </div>
                  <MonoValue>{connections.length}</MonoValue>
                </div>
                {/* Trust / Confidence */}
                <div className="rounded-lg bg-gray-50 p-2.5 text-center">
                  <div className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-gray-400">
                    TRUST
                  </div>
                  <MonoValue className={trustColor(entity.confidence)}>
                    {entity.confidence.toFixed(2)}
                  </MonoValue>
                </div>
                {/* Importance */}
                <div className="rounded-lg bg-gray-50 p-2.5 text-center">
                  <div className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-gray-400">
                    IMPORTANCE
                  </div>
                  <MonoValue className="text-[13px]">
                    {entity.importance ?? "--"}
                  </MonoValue>
                </div>
              </div>

              {/* ============================================================ */}
              {/* Overview section (description, relevance)                    */}
              {/* ============================================================ */}
              <Section
                id="overview"
                title="Overview"
                expanded={expandedSections.has("overview")}
                onToggle={toggleSection}
              >
                {entity.description && (
                  <p className="mb-3 text-[13px] leading-relaxed text-gray-700">
                    {entity.description}
                  </p>
                )}

                {provenance.relevance && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-3 mb-3">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-blue-600 mb-1">
                      Why This Matters
                    </div>
                    <p className="text-[12px] text-gray-700 leading-relaxed">
                      {provenance.relevance}
                    </p>
                  </div>
                )}

                {/* Confidence + Authority in grid */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Confidence */}
                  <div>
                    <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                      Confidence
                    </span>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-gray-200">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            entity.confidence >= 0.7 ? "bg-green-500" : entity.confidence >= 0.4 ? "bg-amber-500" : "bg-red-400"
                          )}
                          style={{ width: `${Math.round(entity.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] font-medium text-gray-600">
                        {Math.round(entity.confidence * 100)}%
                      </span>
                    </div>
                    {provenance.confidence_basis && (
                      <div className="text-[10px] text-gray-500 italic mt-1">
                        {provenance.confidence_basis}
                      </div>
                    )}
                  </div>

                  {/* Authority */}
                  <div>
                    <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                      Authority
                    </span>
                    <div className="mt-1">
                      {entity.authority_level && AUTHORITY_CONFIG[entity.authority_level] ? (
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                            AUTHORITY_CONFIG[entity.authority_level].bg,
                            AUTHORITY_CONFIG[entity.authority_level].color
                          )}
                        >
                          {AUTHORITY_CONFIG[entity.authority_level].label}
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">--</span>
                      )}
                    </div>
                  </div>
                </div>

                {typeof provenance.relevance_score === "number" && (
                  <div className="mt-3">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1">Relevance</div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 rounded-full bg-gray-200">
                        <div
                          className="h-1.5 rounded-full bg-blue-500"
                          style={{ width: `${provenance.relevance_score * 10}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] font-medium text-gray-700">{provenance.relevance_score}/10</span>
                    </div>
                  </div>
                )}
              </Section>

              {/* ============================================================ */}
              {/* 4. EVIDENCE / SOURCES                                       */}
              {/* ============================================================ */}
              <Section
                id="evidence"
                title={`Evidence \u00B7 Sources`}
                count={sourceCount}
                expanded={expandedSections.has("evidence")}
                onToggle={toggleSection}
              >
                {sourceCount === 0 ? (
                  <p className="text-[12px] text-gray-400">No source information</p>
                ) : (
                  <div className="space-y-2.5">
                    {provenance.source_detail && (
                      <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                            getSourceColor(provenance.source_type || "data").bg,
                            getSourceColor(provenance.source_type || "data").text
                          )}>
                            {(provenance.source_type || "DATA").toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[12px] text-gray-700 leading-relaxed">
                          {provenance.source_detail}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-[9px] text-gray-400 uppercase tracking-wider">Trust</span>
                          <span className={cn("font-mono text-[11px] font-medium", trustColor(entity.confidence))}>
                            {entity.confidence.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}

                    {provenance.source_url && (
                      <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                            getSourceColor("web").bg,
                            getSourceColor("web").text
                          )}>
                            WEB
                          </span>
                          <span className="flex items-center gap-0.5 text-[9px] text-green-600">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                            Verified
                          </span>
                        </div>
                        <a
                          href={provenance.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[12px] text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          <Globe className="h-3 w-3 shrink-0" />
                          <span className="truncate">{provenance.source_url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                    )}

                    {provenance.citation_urls && provenance.citation_urls.length > 0 && (
                      <div className="space-y-1.5">
                        {provenance.citation_urls.map((url, i) => (
                          <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                                getSourceColor("paper").bg,
                                getSourceColor("paper").text
                              )}>
                                CITATION
                              </span>
                            </div>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[12px] text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              <Link className="h-3 w-3 shrink-0" />
                              <span className="truncate">{url}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          </div>
                        ))}
                      </div>
                    )}

                    {provenance.detection_method && (
                      <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1">
                          Detection Method
                        </div>
                        <p className="text-[12px] text-gray-700">{provenance.detection_method}</p>
                      </div>
                    )}

                    {provenance.analogous_precedent && (
                      <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1">
                          Analogous Precedent
                        </div>
                        <p className="text-[12px] text-gray-700">{provenance.analogous_precedent}</p>
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* ============================================================ */}
              {/* 5. DECOMPOSITION / SUB-COMPONENTS                           */}
              {/* ============================================================ */}
              {(subComponents.length > 0 || entity.is_decomposable || (provenance.sub_components && provenance.sub_components.length > 0)) && (
                <Section
                  id="decomposition"
                  title={`Decomposition \u00B7 Sub-Components`}
                  count={(provenance.sub_components?.length ?? 0) + subComponents.length}
                  expanded={expandedSections.has("decomposition")}
                  onToggle={toggleSection}
                >
                  {/* Materialized SC_ entities */}
                  {subComponents.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {subComponents.map((sc) => (
                        <button
                          key={sc.id}
                          onClick={() => handleNavigate(sc.entity_id || sc.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors"
                        >
                          <Layers className="h-2.5 w-2.5" />
                          {cleanEntityName(sc)}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Provenance sub_components (not yet materialized) */}
                  {provenance.sub_components && provenance.sub_components.length > 0 && (
                    <div className="space-y-1.5">
                      {provenance.sub_components.map((sc, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/50 p-2.5">
                          <div className="h-5 w-5 rounded bg-blue-100 flex items-center justify-center shrink-0">
                            <Layers className="h-3 w-3 text-blue-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-medium text-gray-800">{sc.name}</span>
                            <span className="ml-2 text-[10px] text-gray-500">{sc.role}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Parent link for expansion_materialization entities */}
                  {provenance.source_type === "expansion_materialization" && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-500">
                      <ChevronUp className="h-3 w-3" />
                      <span>Materialized from parent expansion</span>
                    </div>
                  )}

                  {/* Decomposable hint */}
                  {entity.is_decomposable && subComponents.length === 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-blue-500 font-medium">
                      <ChevronDown className="h-3 w-3" />
                      <span>Can be decomposed further</span>
                    </div>
                  )}
                </Section>
              )}

              {/* ============================================================ */}
              {/* 6. CONNECTIONS (grouped by scope)                            */}
              {/* ============================================================ */}
              <Section
                id="connections"
                title={`Connections \u00B7 ${connections.length}`}
                count={connections.length}
                expanded={expandedSections.has("connections")}
                onToggle={toggleSection}
              >
                {connections.length === 0 ? (
                  <p className="text-[12px] text-gray-400">No connections yet</p>
                ) : (
                  <div className="space-y-4">
                    {Array.from(groupedConnections.entries()).map(([scope, conns]) => (
                      <div key={scope}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={cn("w-2 h-2 rounded-sm",
                            scope === "within_parent" ? "bg-blue-400" :
                            scope === "same_layer" ? "bg-blue-400" :
                            scope === "cross_layer" ? "bg-amber-400" :
                            "bg-emerald-400"
                          )} />
                          <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                            {SCOPE_CONFIG[scope].label} ({conns.length})
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {conns.map((c) => (
                            <ConnectionRow
                              key={c.edge.id}
                              connection={c}
                              scope={scope}
                              onNavigate={handleNavigate}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ============================================================ */}
              {/* 7. MECHANISM & DYNAMICS                                      */}
              {/* ============================================================ */}
              {hasMechanismData && (
                <Section
                  id="mechanism"
                  title="Mechanism & Dynamics"
                  expanded={expandedSections.has("mechanism")}
                  onToggle={toggleSection}
                >
                  {provenance.mechanism && (
                    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 mb-3">
                      <p className="text-[12px] text-gray-700 leading-relaxed">{provenance.mechanism}</p>
                    </div>
                  )}

                  {/* Components as chips */}
                  {provenance.sub_components && provenance.sub_components.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5">
                        Components
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {provenance.sub_components.map((sc, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-700"
                            title={sc.role}
                          >
                            {sc.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Causal chains as arrow-connected items */}
                  {(provenance.causal_upstream?.length ?? 0) + (provenance.causal_downstream?.length ?? 0) > 0 && (
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {provenance.causal_upstream && provenance.causal_upstream.length > 0 && (
                        <div>
                          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5">
                            Driven By
                          </div>
                          <div className="space-y-1">
                            {provenance.causal_upstream.map((item, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                <ArrowRight className="h-2.5 w-2.5 text-gray-400 rotate-180 shrink-0" />
                                <span className="text-gray-700">{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {provenance.causal_downstream && provenance.causal_downstream.length > 0 && (
                        <div>
                          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5">
                            Drives
                          </div>
                          <div className="space-y-1">
                            {provenance.causal_downstream.map((item, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                <ArrowRight className="h-2.5 w-2.5 text-gray-400 shrink-0" />
                                <span className="text-gray-700">{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {provenance.interaction_effects && provenance.interaction_effects.length > 0 && (
                    <div>
                      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5">
                        Interaction Effects
                      </div>
                      <div className="space-y-1.5">
                        {provenance.interaction_effects.map((ie, i) => (
                          <div key={i} className="rounded-lg border-l-2 border-blue-300 bg-blue-50/30 p-2.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="inline-flex rounded-full px-1.5 py-px text-[8px] font-semibold bg-blue-100 text-blue-700 uppercase tracking-wider">
                                {ie.interaction_type}
                              </span>
                              <span className="text-[10px] text-blue-600 font-medium">
                                with {ie.with_entity}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-600 leading-relaxed">{ie.combined_effect}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Section>
              )}

              {/* ============================================================ */}
              {/* Signals section                                              */}
              {/* ============================================================ */}
              <Section
                id="signals"
                title="Signals"
                expanded={expandedSections.has("signals")}
                onToggle={toggleSection}
              >
                {!provenance.signal_type &&
                !provenance.risk_signal_flags?.length &&
                !provenance.connection_hints?.length ? (
                  <p className="text-[12px] text-gray-400">No signals detected</p>
                ) : (
                  <div className="space-y-3">
                    {provenance.signal_type && (
                      <div>
                        <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                          Signal Type
                        </span>
                        <p className="mt-1 text-[12px] text-gray-700">
                          {provenance.signal_type}
                        </p>
                      </div>
                    )}

                    {provenance.risk_signal_flags &&
                      provenance.risk_signal_flags.length > 0 && (
                        <div>
                          <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                            Risk Signal Flags
                          </span>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {provenance.risk_signal_flags.map((flag, i) => (
                              <span
                                key={i}
                                className="inline-flex rounded-full bg-red-50 px-2.5 py-0.5 text-[10px] font-medium text-red-700"
                              >
                                {flag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                    {provenance.connection_hints &&
                      provenance.connection_hints.length > 0 && (
                        <div>
                          <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                            Potential Connections
                          </span>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {provenance.connection_hints.map((hint, i) => (
                              <span
                                key={i}
                                className="inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-medium text-blue-700"
                              >
                                {hint}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </Section>

              {/* ============================================================ */}
              {/* Authority section                                            */}
              {/* ============================================================ */}
              <Section
                id="authority"
                title="Authority"
                expanded={expandedSections.has("authority")}
                onToggle={toggleSection}
              >
                <div className="space-y-2">
                  <p className="text-[11px] text-gray-500">
                    Set the verification level for this entity.
                  </p>
                  <div className="flex gap-2">
                    {(
                      ["high", "moderate", "low", "unverified"] as AuthorityLevel[]
                    ).map((level) => {
                      const config = AUTHORITY_CONFIG[level];
                      const isActive = entity.authority_level === level;
                      return (
                        <button
                          key={level}
                          onClick={() => handleAuthorityClick(level)}
                          disabled={changingAuthority}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-[10px] font-medium transition-colors",
                            "disabled:opacity-50 disabled:cursor-not-allowed",
                            isActive
                              ? cn(config.bg, config.color, "border-current")
                              : "border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50"
                          )}
                        >
                          {config.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Section>

              {/* Bottom spacer to ensure content above action buttons is visible */}
              <div className="h-16" />
            </div>

            {/* ============================================================ */}
            {/* 8. ACTION BUTTONS (sticky bottom)                            */}
            {/* ============================================================ */}
            <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white px-5 py-3 flex items-center gap-2">
              {entity.is_decomposable && (
                <button
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-blue-700 transition-colors"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  Decompose
                </button>
              )}
              <button
                onClick={() => {
                  // Navigate to entity in graph (already focused, this is a no-op / placeholder for future explore action)
                  onNavigate(entity.entity_id || entity.id);
                }}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors",
                  entity.is_decomposable ? "" : "flex-1"
                )}
              >
                <Search className="h-3.5 w-3.5" />
                Explore
              </button>
              <button
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── Connection row sub-component (compact, with left border accent) ──

function ConnectionRow({
  connection,
  scope,
  onNavigate,
}: {
  connection: Connection;
  scope: ConnectionScope;
  onNavigate: (entityId: string) => void;
}) {
  const { entity: connectedEntity, edge, direction } = connection;
  const [showConditions, setShowConditions] = useState(false);
  const relColor = getRelColor(edge.relationship_type);
  const targetId = connectedEntity.entity_id || connectedEntity.id;

  return (
    <div
      className={cn(
        "rounded-lg border border-gray-100 border-l-[3px] p-2.5 hover:bg-gray-50/80 transition-colors",
        SCOPE_CONFIG[scope].border
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <button
            onClick={() => onNavigate(targetId)}
            className="font-mono text-[12px] font-medium text-blue-600 hover:text-blue-800 hover:underline text-left truncate block max-w-full"
          >
            {cleanEntityName(connectedEntity)}
          </button>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "inline-flex rounded-full px-1.5 py-px text-[9px] font-medium",
                relColor.bg,
                relColor.text
              )}
            >
              {edge.relationship_type.replace(/_/g, " ")}
            </span>
            <span className="flex items-center gap-0.5 text-[9px] text-gray-400">
              {direction === "outgoing" ? (
                <>
                  <ArrowRight className="h-2.5 w-2.5" />
                </>
              ) : (
                <>
                  <ArrowLeft className="h-2.5 w-2.5" />
                </>
              )}
            </span>
          </div>
        </div>
        {/* Strength score, right-aligned, mono font */}
        <span className="font-mono text-[12px] font-medium text-gray-500 shrink-0">
          {edge.strength.toFixed(2)}
        </span>
      </div>

      {/* Conditions (collapsed by default) */}
      {edge.conditions && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowConditions((v) => !v);
            }}
            className="mt-1.5 flex items-center gap-1 text-[9px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showConditions ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            Conditions
          </button>
          {showConditions && (
            <p className="mt-1 rounded bg-gray-50 p-2 text-[10px] text-gray-600 leading-relaxed">
              {edge.conditions}
            </p>
          )}
        </>
      )}
    </div>
  );
}
