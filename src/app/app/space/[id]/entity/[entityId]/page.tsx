"use client";

// ── Entity detail canvas page ──
// /app/space/[id]/entity/[entityId]
//
// The Tier-3 view of a single entity — a unified canvas combining:
//   - Header with name / confidence / evidence badges
//   - Persistent upstream/downstream rail (traversable breadcrumb)
//   - Main column: description + sub-components (expansion preview) + evidence
//   - Right rail: quick actions + deep-link buttons (probability space, decompose)
//
// Tier 1 = hover dropdown on graph (to be added)
// Tier 2 = right-sidebar node-detail (existing)
// Tier 3 = this page

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  Target,
  Layers,
  MessageCircleQuestion,
  Sparkles,
  ExternalLink,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpaceData } from "@/contexts/space-data-context";
import { EvidenceSection } from "@/components/entity/evidence-section";
import { EntityNeighborRail } from "@/components/entity/entity-neighbor-rail";
import { EntityCoverageBadge } from "@/components/entity/entity-coverage-badge";
import { PathwaysTable } from "@/components/entity/pathways-table";
import { EntityQuestionsPanel } from "@/components/entity/entity-questions-panel";
import { getNodeColor } from "@/lib/design-tokens";
import { MermaidDiagram } from "@/components/diagrams/mermaid-diagram";
import { generateExpansionDiagram } from "@/lib/diagrams/expansion-diagram";
import { generateNeighborhoodDiagram } from "@/lib/diagrams/neighborhood-diagram";
import { generateCycleDiagram } from "@/lib/diagrams/cycle-diagram";
import { generateCascadeDiagram } from "@/lib/diagrams/cascade-diagram";
import type { Expansion } from "@/types/expansion";

export default function EntityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ctx = useSpaceData();

  const entityId = Array.isArray(params?.entityId) ? params.entityId[0] : params?.entityId;
  const spaceId = ctx.space.id;

  const entity = useMemo(() => {
    if (!entityId) return null;
    return ctx.entities.find((e) => e.id === entityId) ?? null;
  }, [ctx.entities, entityId]);

  // Filter claims for this entity
  const entityClaims = useMemo(() => {
    if (!entity) return [];
    return ctx.claims.filter((c) => c.source_entity_id === entity.id);
  }, [ctx.claims, entity]);

  // Expansion (sub-components) — hydrated from cache if available, LLM-generated on demand
  const [expansion, setExpansion] = useState<Expansion | null>(null);
  const [expansionLoading, setExpansionLoading] = useState(false);
  const [expansionError, setExpansionError] = useState<string | null>(null);

  // Local UI state
  const [mode, setMode] = useState<"structure" | "probability" | "evidence" | "diagram" | "questions">("structure");
  type DiagramKind = "expansion" | "neighborhood" | "cycle" | "cascade";
  const [diagramKind, setDiagramKind] = useState<DiagramKind>("neighborhood");
  // When true, EntityQuestionsPanel opens its inline form on mount
  const [forceQuestionForm, setForceQuestionForm] = useState(false);

  // On mount: try to load cached expansion (GET)
  useEffect(() => {
    if (!entity) return;
    let cancelled = false;
    setExpansionLoading(true);
    setExpansionError(null);
    (async () => {
      try {
        const res = await fetch(`/api/pipeline/expand/${entity.id}`);
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json() as { expansion?: Expansion };
            setExpansion(data.expansion ?? null);
          } else {
            // 404 is expected for entities never expanded — just clear silently
            setExpansion(null);
          }
        }
      } catch {
        if (!cancelled) setExpansionError("Failed to load expansion");
      } finally {
        if (!cancelled) setExpansionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entity]);

  // Trigger a fresh decomposition via POST /api/pipeline/expand
  const handleDecompose = useCallback(async () => {
    if (!entity) return;
    setExpansionLoading(true);
    setExpansionError(null);
    try {
      const res = await fetch("/api/pipeline/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: entity.id, spaceId }),
      });
      if (!res.ok) {
        setExpansionError("Decomposition failed");
        return;
      }
      const data = await res.json() as { expansion?: Expansion };
      setExpansion(data.expansion ?? null);
    } catch (err) {
      setExpansionError(err instanceof Error ? err.message : "Failed to decompose");
    } finally {
      setExpansionLoading(false);
    }
  }, [entity, spaceId]);

  // ─── Diagram availability + source generation ───
  // Which diagram kinds have enough data to render right now?
  const availableDiagrams = useMemo(() => {
    const set = new Set<DiagramKind>(["neighborhood"]); // always available
    if (expansion?.sub_components && expansion.sub_components.length > 0) set.add("expansion");
    if (entity) {
      const inCycle = ctx.cycles.some((c) => c.entity_ids?.includes(entity.entity_id));
      if (inCycle) set.add("cycle");
      if ((entity.blast_radius ?? 0) > 0) set.add("cascade");
    }
    return set;
  }, [expansion, entity, ctx.cycles]);

  // Auto-pick a sensible default when the user first opens the Diagram tab
  useEffect(() => {
    if (mode !== "diagram") return;
    if (availableDiagrams.has(diagramKind)) return;
    // Priority: expansion (if expanded) > cycle > cascade > neighborhood (always)
    if (availableDiagrams.has("expansion")) setDiagramKind("expansion");
    else if (availableDiagrams.has("cycle")) setDiagramKind("cycle");
    else if (availableDiagrams.has("cascade")) setDiagramKind("cascade");
    else setDiagramKind("neighborhood");
  }, [mode, diagramKind, availableDiagrams]);

  // Build the Mermaid source for the chosen diagram kind.
  const diagramSource = useMemo<string | null>(() => {
    if (mode !== "diagram" || !entity) return null;

    if (diagramKind === "neighborhood") {
      // Compute immediate upstream/downstream from raw edges
      const entityByUuid = new Map(ctx.entities.map((e) => [e.id, e]));
      const upstream: Array<{ entity_id: string; name: string; relationship: string }> = [];
      const downstream: Array<{ entity_id: string; name: string; relationship: string }> = [];
      const seenUp = new Set<string>();
      const seenDown = new Set<string>();
      for (const ed of ctx.edges) {
        if (ed.target_entity_id === entity.id && !seenUp.has(ed.source_entity_id)) {
          seenUp.add(ed.source_entity_id);
          const n = entityByUuid.get(ed.source_entity_id);
          if (n) upstream.push({ entity_id: n.id, name: n.name, relationship: ed.relationship_type });
        }
        if (ed.source_entity_id === entity.id && !seenDown.has(ed.target_entity_id)) {
          seenDown.add(ed.target_entity_id);
          const n = entityByUuid.get(ed.target_entity_id);
          if (n) downstream.push({ entity_id: n.id, name: n.name, relationship: ed.relationship_type });
        }
      }
      return generateNeighborhoodDiagram({
        focal: { entity_id: entity.id, name: entity.name },
        upstream,
        downstream,
      });
    }

    if (diagramKind === "expansion" && expansion) {
      return generateExpansionDiagram({
        parent_name: entity.name,
        sub_components: expansion.sub_components,
        internal_pathways: expansion.internal_pathways,
        internal_dynamics: expansion.internal_dynamics,
      });
    }

    if (diagramKind === "cycle") {
      const cycle = ctx.cycles.find((c) => c.entity_ids?.includes(entity.entity_id));
      if (!cycle) return null;
      // Build name lookup keyed by entity_id (e.g. "C1") — cycle stores those
      const nameMap: Record<string, string> = {};
      for (const e of ctx.entities) nameMap[e.entity_id] = e.name;
      return generateCycleDiagram({
        name: cycle.name ?? "Feedback loop",
        classification: cycle.classification,
        entity_ids: cycle.entity_ids,
        entity_names: nameMap,
        intervention_entity_id: cycle.intervention_point_entity_id ?? null,
      });
    }

    if (diagramKind === "cascade") {
      // Downstream entities within 2 hops as a proxy for cascade affected set
      const byUuid = new Map(ctx.entities.map((e) => [e.id, e]));
      const hop1 = new Set<string>();
      const hop2 = new Set<string>();
      for (const ed of ctx.edges) {
        if (ed.source_entity_id === entity.id) hop1.add(ed.target_entity_id);
      }
      for (const id of hop1) {
        for (const ed of ctx.edges) {
          if (ed.source_entity_id === id && !hop1.has(ed.target_entity_id) && ed.target_entity_id !== entity.id) {
            hop2.add(ed.target_entity_id);
          }
        }
      }
      const affected: Array<{ entity_id: string; name?: string; distance: number; impact?: string }> = [];
      for (const id of hop1) {
        const n = byUuid.get(id);
        if (n) affected.push({ entity_id: n.id, name: n.name, distance: 1, impact: "high" });
      }
      for (const id of hop2) {
        const n = byUuid.get(id);
        if (n) affected.push({ entity_id: n.id, name: n.name, distance: 2, impact: "medium" });
      }
      // Normalize blast_radius to 0-1 for the diagram caption
      const raw = entity.blast_radius ?? 0;
      const normalized = raw > 1 ? Math.min(1, raw / 100) : raw;
      return generateCascadeDiagram({
        source_entity_id: entity.id,
        source_entity_name: entity.name,
        blast_radius: normalized,
        affected,
      });
    }

    return null;
  }, [mode, entity, diagramKind, expansion, ctx.entities, ctx.edges, ctx.cycles]);

  if (!entityId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        No entity specified.
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-500">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <div>Entity not found in this space.</div>
        <Link
          href={`/app/space/${spaceId}`}
          className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to space
        </Link>
      </div>
    );
  }

  const catColors = getNodeColor(entity.entity_category);
  const entityMap = new Map(ctx.entities.map((e) => [e.id, e]));

  // Confidence tier
  const confidencePct = Math.round((entity.confidence ?? 0) * 100);
  const confidenceColor =
    confidencePct >= 80 ? "bg-emerald-500"
      : confidencePct >= 50 ? "bg-amber-500"
      : "bg-rose-500";

  // Evidence profile
  const claimsByStatus = entityClaims.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  const supported = claimsByStatus.supported ?? 0;
  const contested = claimsByStatus.contested ?? 0;
  const assumed = entityClaims.filter((c) => c.source_quote?.startsWith("ASSUMED")).length;

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* ─── Breadcrumb ─── */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-5 py-2 text-[11px] text-gray-500">
        <Link href={`/app/space/${spaceId}`} className="hover:text-gray-700">
          {ctx.space.name}
        </Link>
        <span>/</span>
        <span className="font-medium text-gray-400">Entity</span>
        <span>/</span>
        <span className="font-semibold text-gray-800 truncate max-w-md">{entity.name}</span>
      </div>

      {/* ─── Header ─── */}
      <div
        className="border-b border-gray-200 bg-white px-5 py-4"
        style={{ boxShadow: `inset 4px 0 0 ${catColors.stroke}` }}
      >
        <div className="flex items-start gap-4">
          {/* Category badge */}
          <div
            className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: `${catColors.fill}30`,
              color: catColors.stroke,
            }}
          >
            {entity.entity_category}
          </div>

          {/* Title block */}
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-gray-900">{entity.name}</h1>
            {entity.entity_type && (
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {entity.entity_type}
              </div>
            )}
            {entity.description && (
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-gray-600">
                {entity.description}
              </p>
            )}
          </div>

          {/* Stat badges */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Confidence */}
            <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
              <div className="flex flex-col">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
                  Confidence
                </span>
                <span className="text-sm font-bold text-gray-800 tabular-nums">
                  {confidencePct}%
                </span>
              </div>
              <div className="h-6 w-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={cn("h-full w-full", confidenceColor)}
                  style={{ transform: `translateY(${100 - confidencePct}%)` }}
                />
              </div>
            </div>

            {/* Evidence profile */}
            {entityClaims.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
                <div className="flex flex-col">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
                    Evidence
                  </span>
                  <span className="text-sm font-bold text-gray-800 tabular-nums">
                    {entityClaims.length}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 text-[9px]">
                  {supported > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-600">
                      <span className="h-1 w-1 rounded-full bg-emerald-500" /> {supported}
                    </span>
                  )}
                  {contested > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-rose-600">
                      <span className="h-1 w-1 rounded-full bg-rose-500" /> {contested}
                    </span>
                  )}
                  {assumed > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-gray-500">
                      <span className="h-1 w-1 rounded-full bg-gray-400" /> {assumed}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Role flags */}
            <div className="flex flex-col gap-0.5">
              {entity.is_master_bottleneck && (
                <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                  Master bottleneck
                </span>
              )}
              {entity.is_leverage_point && !entity.is_master_bottleneck && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                  Leverage
                </span>
              )}
              {entity.is_risk_point && !entity.is_master_bottleneck && (
                <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                  Risk
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Coverage badge (per-entity analysis footprint) ─── */}
      <div className="border-b border-gray-200 bg-gradient-to-b from-gray-50 to-white px-5 py-2">
        <EntityCoverageBadge spaceId={spaceId} entityId={entity.id} />
      </div>

      {/* ─── Upstream / Downstream Rail ─── */}
      <div className="border-b border-gray-200 bg-white px-5 py-3">
        <EntityNeighborRail
          spaceId={spaceId}
          entity={entity}
          entities={ctx.entities}
          edges={ctx.edges}
        />
      </div>

      {/* ─── Main Grid: Sub-components / Evidence / Actions ─── */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto grid max-w-7xl gap-4 p-5 lg:grid-cols-[1fr_320px]">
          {/* ─── CENTER: Mode-switched content ─── */}
          <div className="space-y-4">
            {/* Mode switcher */}
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-[11px] font-semibold">
              {(["structure", "probability", "evidence", "diagram", "questions"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-md px-3 py-1.5 capitalize transition-all",
                    mode === m
                      ? "bg-interaxis-100 text-interaxis-700 shadow-sm"
                      : "text-gray-500 hover:text-gray-700",
                  )}
                >
                  {m === "structure" && <Layers className="mr-1 inline h-3 w-3" />}
                  {m === "probability" && <Target className="mr-1 inline h-3 w-3" />}
                  {m === "evidence" && <FileText className="mr-1 inline h-3 w-3" />}
                  {m === "diagram" && <Sparkles className="mr-1 inline h-3 w-3" />}
                  {m === "questions" && <MessageCircleQuestion className="mr-1 inline h-3 w-3" />}
                  {m}
                </button>
              ))}
            </div>

            {/* Mode: Structure — sub-components */}
            {mode === "structure" && (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-gray-400" />
                  <h2 className="text-sm font-bold text-gray-800">Internal Structure</h2>
                  {expansion?.sub_components && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                      {expansion.sub_components.length} components
                    </span>
                  )}
                </div>

                {expansionLoading && (
                  <div className="py-8 text-center text-sm text-gray-400">
                    Loading sub-components…
                  </div>
                )}

                {expansionError && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    {expansionError}
                  </div>
                )}

                {!expansionLoading && !expansion && entity.is_decomposable && (
                  <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                    <p className="mb-3 text-sm text-gray-600">
                      This entity hasn&apos;t been decomposed yet.
                    </p>
                    <button
                      onClick={() => handleDecompose()}
                      className="rounded-md bg-interaxis-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-interaxis-700"
                    >
                      Decompose this entity
                    </button>
                  </div>
                )}

                {expansion && expansion.sub_components.length > 0 && (
                  <div className="space-y-2">
                    {expansion.sub_components.map((sc) => (
                      <div
                        key={sc.id}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-3 hover:border-gray-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] font-bold text-gray-400">
                                {sc.id}
                              </span>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                {sc.component_type}
                              </span>
                              {sc.importance && (
                                <span
                                  className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                                    sc.importance === "critical" && "bg-red-100 text-red-700",
                                    sc.importance === "important" && "bg-amber-100 text-amber-700",
                                    sc.importance === "moderate" && "bg-gray-100 text-gray-600",
                                    sc.importance === "minor" && "bg-gray-50 text-gray-400",
                                  )}
                                >
                                  {sc.importance}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">{sc.name}</div>
                            {sc.description && (
                              <div className="mt-1 text-[12px] leading-snug text-gray-600">
                                {sc.description}
                              </div>
                            )}
                          </div>
                          {/* Probability */}
                          <div className="shrink-0">
                            <div
                              className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white tabular-nums",
                                sc.probability >= 0.7
                                  ? "bg-emerald-500"
                                  : sc.probability >= 0.4
                                    ? "bg-amber-500"
                                    : "bg-rose-500",
                              )}
                              title={`${Math.round(sc.probability * 100)}% probability`}
                            >
                              {Math.round(sc.probability * 100)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Internal dynamics */}
                {expansion?.internal_dynamics && expansion.internal_dynamics.length > 0 && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Internal Dynamics
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {expansion.internal_dynamics.map((dyn, i) => (
                        <div
                          key={i}
                          className="rounded-md border border-gray-200 bg-white p-2 text-[11px]"
                        >
                          <div className="font-bold uppercase tracking-wider text-gray-500">
                            {dyn.type.replace(/_/g, " ")}
                          </div>
                          <div className="mt-0.5 text-gray-700">{dyn.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mode: Probability — pathways table + counterfactual sliders */}
            {mode === "probability" && (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Target className="h-4 w-4 text-gray-400" />
                  <h2 className="text-sm font-bold text-gray-800">Probability Space</h2>
                  {expansion?.sub_components && expansion.sub_components.length > 0 && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                      {expansion.sub_components.length} components
                    </span>
                  )}
                </div>

                {expansion?.sub_components && expansion.sub_components.length > 0 ? (
                  <>
                    <p className="mb-4 text-[13px] leading-relaxed text-gray-600">
                      All source→sink pathways through this entity&apos;s internal structure,
                      ranked by cumulative probability. Drag the hop sliders below to run a
                      <span className="font-semibold text-purple-700"> counterfactual</span> — the
                      entire pathway table recomputes live. Critical path is highlighted in green.
                    </p>
                    <PathwaysTable
                      sub_components={expansion.sub_components}
                      internal_pathways={expansion.internal_pathways}
                      internal_dynamics={expansion.internal_dynamics}
                    />

                    {/* Secondary link to legacy convergent-points view */}
                    <div className="mt-4 border-t border-gray-100 pt-3">
                      <Link
                        href={`/app/space/${spaceId}/probability/node/${entity.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        <Target className="h-3 w-3" />
                        Open convergent-points view (Tier-1 through Tier-3 interactors)
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] leading-relaxed text-gray-600">
                      Decompose this entity first to enumerate its internal pathways.
                      Once sub-components exist, you can explore every source→sink route
                      through the structure and run counterfactual probability simulations.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {entity.is_decomposable && (
                        <button
                          onClick={handleDecompose}
                          disabled={expansionLoading}
                          className="inline-flex items-center gap-1.5 rounded-md bg-interaxis-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-interaxis-700 disabled:opacity-50"
                        >
                          <Layers className="h-3 w-3" />
                          {expansionLoading ? "Decomposing…" : "Decompose this entity"}
                        </button>
                      )}
                      <Link
                        href={`/app/space/${spaceId}/probability/node/${entity.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        <Target className="h-3 w-3" />
                        Open convergent-points view
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Mode: Evidence */}
            {mode === "evidence" && (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-400" />
                  <h2 className="text-sm font-bold text-gray-800">Evidence & Claims</h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                    {entityClaims.length}
                  </span>
                </div>
                {entityClaims.length === 0 ? (
                  <p className="text-[13px] italic text-gray-400">
                    No claims yet. Add evidence via the + button or run deep research.
                  </p>
                ) : (
                  <EvidenceSection claims={entityClaims} />
                )}
              </div>
            )}

            {/* Mode: Diagram — generated Mermaid visualizations */}
            {mode === "diagram" && (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-gray-400" />
                  <h2 className="text-sm font-bold text-gray-800">Generated Diagram</h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                    {availableDiagrams.size} types
                  </span>
                </div>

                {/* Diagram-kind selector */}
                <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-[11px] font-semibold">
                  {(["expansion", "neighborhood", "cycle", "cascade"] as const).map((k) => {
                    const avail = availableDiagrams.has(k);
                    return (
                      <button
                        key={k}
                        onClick={() => avail && setDiagramKind(k)}
                        disabled={!avail}
                        title={
                          !avail
                            ? k === "expansion"
                              ? "Decompose the entity first to render internal structure"
                              : k === "cycle"
                                ? "This entity is not part of a detected cycle"
                                : k === "cascade"
                                  ? "No downstream edges to cascade"
                                  : "Unavailable"
                            : `${k} diagram`
                        }
                        className={cn(
                          "rounded-md px-3 py-1.5 capitalize transition-all",
                          !avail && "cursor-not-allowed text-gray-300",
                          avail && diagramKind === k && "bg-interaxis-100 text-interaxis-700 shadow-sm",
                          avail && diagramKind !== k && "text-gray-500 hover:text-gray-700",
                        )}
                      >
                        {k}
                      </button>
                    );
                  })}
                </div>

                {diagramSource ? (
                  <MermaidDiagram
                    source={diagramSource}
                    ariaLabel={`${diagramKind} diagram for ${entity.name}`}
                    maxHeight={520}
                  />
                ) : (
                  <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
                    No data to render this diagram type yet.
                  </div>
                )}

                {/* Helper note */}
                <p className="mt-3 text-[11px] leading-snug text-gray-500">
                  {diagramKind === "neighborhood" && "Immediate upstream + downstream connections, labeled by relationship type."}
                  {diagramKind === "expansion" && "The entity's internal sub-components and pathways — shown as a Mermaid flowchart. Node color = component type; border weight = importance; dashed edges = probabilistic or conditional dynamics."}
                  {diagramKind === "cycle" && "The feedback loop this entity participates in. The intervention-point node (if detected) is highlighted in blue."}
                  {diagramKind === "cascade" && "Approximate cascade failure: entities reached within 2 downstream hops. Hop 1 = high severity, hop 2 = medium."}
                </p>
              </div>
            )}

            {/* Mode: Questions — user-authored threads attached to this entity */}
            {mode === "questions" && (
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <EntityQuestionsPanel
                  spaceId={spaceId}
                  entityId={entity.id}
                  forceOpenForm={forceQuestionForm}
                  onFormClosed={() => setForceQuestionForm(false)}
                />
                <p className="mt-4 border-t border-gray-100 pt-3 text-[11px] leading-snug text-gray-500">
                  Ask a specific question you want answered about this entity.
                  Open questions are stored with the entity so they surface in
                  subsequent synthesis passes — and a research agent can
                  eventually flip their status to <span className="font-semibold">answered</span> by
                  attaching claims or new edges back to this node.
                </p>
              </div>
            )}
          </div>

          {/* ─── RIGHT RAIL: Quick Actions ─── */}
          <aside className="space-y-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                Actions
              </h3>
              <div className="space-y-1.5">
                <button
                  onClick={() => {
                    if (!entity.is_decomposable) return;
                    handleDecompose();
                  }}
                  disabled={!entity.is_decomposable || expansionLoading}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold transition-all",
                    entity.is_decomposable
                      ? "border border-gray-200 bg-white text-gray-800 hover:border-interaxis-300 hover:bg-interaxis-50"
                      : "cursor-not-allowed border border-gray-100 bg-gray-50 text-gray-400",
                  )}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <div className="flex-1">
                    <div>Decompose</div>
                    <div className="text-[10px] font-normal text-gray-500">
                      Break into sub-components
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setMode("questions");
                    setForceQuestionForm(true);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold transition-all",
                    mode === "questions"
                      ? "border border-interaxis-300 bg-interaxis-50 text-interaxis-700"
                      : "border border-gray-200 bg-white text-gray-800 hover:border-interaxis-300 hover:bg-interaxis-50",
                  )}
                  title="Ask a specific question about this entity — stored as an open thread"
                >
                  <MessageCircleQuestion className="h-3.5 w-3.5" />
                  <div className="flex-1">
                    <div>Ask a question</div>
                    <div className="text-[10px] font-normal text-gray-500">
                      Attach a research thread
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setMode("diagram")}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold transition-all",
                    mode === "diagram"
                      ? "border border-interaxis-300 bg-interaxis-50 text-interaxis-700"
                      : "border border-gray-200 bg-white text-gray-800 hover:border-interaxis-300 hover:bg-interaxis-50",
                  )}
                  title="Mermaid visualization (neighborhood, expansion, cycle, or cascade)"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <div className="flex-1">
                    <div>Generate diagram</div>
                    <div className="text-[10px] font-normal text-gray-500">
                      {availableDiagrams.size} {availableDiagrams.size === 1 ? "type" : "types"} available
                    </div>
                  </div>
                </button>

                <Link
                  href={`/app/space/${spaceId}/probability/node/${entity.id}`}
                  className="w-full flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-xs font-semibold text-gray-800 hover:border-interaxis-300 hover:bg-interaxis-50"
                >
                  <Target className="h-3.5 w-3.5" />
                  <div className="flex-1">
                    <div>Probability space</div>
                    <div className="text-[10px] font-normal text-gray-500">
                      Outcomes + convergent points
                    </div>
                  </div>
                </Link>

                <button
                  onClick={() => router.back()}
                  className="w-full flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
              </div>
            </div>

            {/* Properties summary card */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                Properties
              </h3>
              <dl className="space-y-1.5 text-[11px]">
                {entity.knowledge_layer && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Layer</dt>
                    <dd className="font-semibold capitalize text-gray-800">{entity.knowledge_layer}</dd>
                  </div>
                )}
                {entity.authority_level && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Authority</dt>
                    <dd className="font-semibold capitalize text-gray-800">{entity.authority_level}</dd>
                  </div>
                )}
                {entity.source_tag && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Source</dt>
                    <dd className="font-semibold capitalize text-gray-800">{entity.source_tag}</dd>
                  </div>
                )}
                {entity.blast_radius != null && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Blast radius</dt>
                    <dd className="font-semibold tabular-nums text-gray-800">{entity.blast_radius}</dd>
                  </div>
                )}
                {entity.centrality_rank != null && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Centrality</dt>
                    <dd className="font-semibold tabular-nums text-gray-800">#{entity.centrality_rank}</dd>
                  </div>
                )}
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
