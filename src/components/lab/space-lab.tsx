"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { Entity, Edge, Bridge, Space } from "@/types";
import type { Reaction } from "@/types/reactions";
import { LabHeader } from "./lab-header";
import { LabReagentBay } from "./lab-reagent-bay";
import { LabChamberReact } from "./lab-chamber-react";
import { LabChamberSpectrum } from "./lab-chamber-spectrum";
import { LabAnalysis } from "./lab-analysis";
import { LabReactionNetwork } from "./lab-reaction-network";
import { LabControlPanel } from "./lab-control-panel";
import { LabDistribution } from "./lab-distribution";
import { useEntityParameters } from "./hooks/use-entity-parameters";
import { useLabUrlState } from "./hooks/use-lab-url-state";
import {
  throughput as computeThroughput,
  type InstrumentParameters,
} from "@/lib/lab-formulas";
import type { LabMode } from "./lab-mode-switcher";

const LabChamber3D = dynamic(() => import("./lab-chamber-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#02050a]">
      <div className="flex items-center gap-2 text-[11px] text-[#4ade80]/80">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Initializing reactor chamber…
      </div>
    </div>
  ),
});

export interface SpaceLabProps {
  space: Space;
  heroes: Entity[];
  entities: Entity[];
  edges: Edge[];
  reactions: Reaction[];
  bridges: Bridge[];
  /**
   * Phase 25: real cross-space partner entity rows fetched server-side
   * by the lab page. When present, supersedes the synthesized stub for
   * that id so the reagent bay shows real names + categories.
   */
  partnerEntities?: Entity[];
}

/**
 * Builds a synthetic Entity that represents the *space itself* as a
 * specimen. Used as the focal for the shared Lab components so we don't
 * have to parameterize every subcomponent with `scope: "entity" | "space"`.
 * The synthetic entity's UUID = the space's id, so deep links still work.
 */
function synthesizeSpaceAsEntity(space: Space, entities: Entity[]): Entity {
  const avgConfidence = entities.length > 0
    ? entities.reduce((s, e) => s + ((e.confidence as number) ?? 0.7), 0) / entities.length
    : 0.8;
  const leverageCount = entities.filter((e) => e.is_leverage_point).length;
  const dominantLayer = (() => {
    const counts = new Map<string, number>();
    for (const e of entities) {
      const l = e.layer ?? "thread";
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    let best = "thread";
    let bestCount = 0;
    for (const [k, v] of counts) {
      if (v > bestCount) {
        best = k;
        bestCount = v;
      }
    }
    return best;
  })();

  return {
    id: space.id,
    space_id: space.id,
    entity_id: "SPACE",
    name: space.name,
    description: space.description ?? `Space with ${entities.length} entities.`,
    source_tag: "explicit",
    entity_type: "space",
    entity_category: "abstract",
    layer: "system",
    depth: 0,
    importance: leverageCount > 0 ? "fundamental" : "critical",
    confidence: avgConfidence,
    is_leverage_point: leverageCount > 0,
    is_risk_point: false,
    blast_radius: entities.length,
    centrality_rank: 0,
    is_shared_variable: false,
    is_decomposable: true,
    is_master_bottleneck: false,
    has_sub_space: false,
    sub_space_id: null,
    graph_x: null,
    graph_y: null,
    knowledge_layer: "internal",
    provenance: {
      source_type: "space_lab",
      dominant_layer: dominantLayer,
      leverage_count: leverageCount,
      entity_count: entities.length,
    },
    authority_level: "high",
    ambiguity_type: null,
    temporal_validity: null,
    manifold: null,
    expansion_id: null,
    is_expanded: true,
    causal_role: null,
    theory_type: null,
    falsifiability_score: null,
    evidence_strength: null,
    analysis_count: 0,
    last_analyzed_at: null,
    connection_search_count: 0,
    last_connection_search_at: null,
    decomposition_probed_at: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as Entity;
}

/**
 * Renders cross-space bridges as pseudo-edges touching the space. Each
 * bridge becomes one "partner" on the up- or downstream arc depending
 * on whether this space is the bridge's source or target.
 */
function bridgesToEdges(
  space: Space,
  bridges: Bridge[],
  entitiesBySpace: Map<string, Entity[]>,
): {
  upstream: Array<{ edge: Edge; partner: Entity }>;
  downstream: Array<{ edge: Edge; partner: Entity }>;
} {
  const upstream: Array<{ edge: Edge; partner: Entity }> = [];
  const downstream: Array<{ edge: Edge; partner: Entity }> = [];
  for (const b of bridges) {
    const isSource = b.source_space_id === space.id;
    const partnerSpaceId = isSource ? b.target_space_id : b.source_space_id;
    const entitiesInPartner = entitiesBySpace.get(partnerSpaceId) ?? [];
    const partnerEntityId = isSource ? b.target_entity_id : b.source_entity_id;
    const partner = entitiesInPartner.find((e) => e.id === partnerEntityId);
    if (!partner) continue;

    const pseudoEdge: Edge = {
      id: `bridge-${b.id}`,
      space_id: space.id,
      source_entity_id: isSource ? space.id : partner.id,
      target_entity_id: isSource ? partner.id : space.id,
      relationship_type: b.shared_variable_name ?? "bridges",
      dimension: "comparative",
      source_tag: "predicted",
      strength:
        b.coupling_strength === "strong"
          ? 0.9
          : b.coupling_strength === "moderate"
            ? 0.7
            : 0.5,
      polarity: "positive",
      confidence: (b.confidence as number | null) ?? 0.7,
      conditions: b.description,
      is_tradeoff: false,
      is_part_of_cycle: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as Edge;

    if (isSource) {
      downstream.push({ edge: pseudoEdge, partner });
    } else {
      upstream.push({ edge: pseudoEdge, partner });
    }
  }
  return { upstream, downstream };
}

export function SpaceLab({
  space,
  heroes,
  entities,
  edges,
  reactions,
  bridges,
  partnerEntities,
}: SpaceLabProps) {
  const focal = useMemo(() => synthesizeSpaceAsEntity(space, entities), [space, entities]);

  // For the reagent bay, "subunits" = hero entities. They're the visible
  // components of the space reactor.
  const subunits = heroes;

  // Load cross-space partner entities (they live in OTHER spaces). For
  // the MVP we've already loaded all bridges; look up partner entities
  // against the current space's entity list plus whatever sibling-space
  // entities the bridge naturally resolves to. If a partner entity isn't
  // hydrated, render it as a synthetic Entity-lite so the chamber still
  // draws the bond.
  const bridgeEntityById = useMemo(() => {
    const m = new Map<string, Entity>();
    // Phase 25: prefer real hydrated partner rows when available — these
    // were fetched server-side by SpaceLabPage. Index them first so the
    // synthesize step below skips ids that already have a real row.
    if (partnerEntities) {
      for (const p of partnerEntities) m.set(p.id, p);
    }
    // Synthesize placeholders for any partner entity we don't have locally
    // (e.g. partner space the user no longer owns, or RLS-blocked rows).
    for (const b of bridges) {
      for (const [id, spaceId] of [
        [b.source_entity_id, b.source_space_id],
        [b.target_entity_id, b.target_space_id],
      ] as const) {
        if (spaceId === space.id) continue;
        if (m.has(id)) continue;
        const name = b.shared_variable_name ?? "(cross-space)";
        m.set(id, {
          id,
          space_id: spaceId,
          entity_id: `x-${id.slice(0, 6)}`,
          name,
          description: b.description ?? null,
          entity_category: "abstract",
          entity_type: "concept",
          layer: "thread",
          depth: 2,
          importance: "moderate",
          confidence: (b.confidence as number | null) ?? 0.7,
          source_tag: "predicted",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as unknown as Entity);
      }
    }
    return m;
  }, [bridges, space.id, partnerEntities]);

  const entitiesBySpace = useMemo(() => {
    const m = new Map<string, Entity[]>();
    m.set(space.id, entities);
    // Grouped cross-space partners come from the synthesized map
    for (const e of bridgeEntityById.values()) {
      if (!m.has(e.space_id)) m.set(e.space_id, []);
      m.get(e.space_id)!.push(e);
    }
    return m;
  }, [entities, bridgeEntityById, space.id]);

  const { upstream: upstreamEdges, downstream: downstreamEdges } = useMemo(
    () => bridgesToEdges(space, bridges, entitiesBySpace),
    [space, bridges, entitiesBySpace],
  );

  // Entity lookup (used by react chamber + reaction network)
  const entitiesByUuid = useMemo(() => {
    const m = new Map<string, Entity>();
    m.set(focal.id, focal);
    for (const e of entities) m.set(e.id, e);
    for (const e of bridgeEntityById.values()) m.set(e.id, e);
    return m;
  }, [focal, entities, bridgeEntityById]);

  const [hoveredSubunitId, setHoveredSubunitId] = useState<string | null>(null);
  const [mode, setMode] = useState<LabMode>("structure");
  const [reactTray, setReactTray] = useState<string[]>([]);
  // Phase 27: URL-backed lab state (shareable `?rxn=...&tune=...`).
  const {
    focusedReactionId,
    setFocusedReactionId,
    selectedSubunitId,
    setSelectedSubunitId,
  } = useLabUrlState();

  // Phase 21: which entity is the control panel currently tuning?
  // Hero subunits ARE real DB rows so we persist; focal is synthetic, so
  // when no subunit is selected we run in-memory.
  const tuningEntity = useMemo<Entity>(() => {
    if (!selectedSubunitId) return focal;
    return subunits.find((s) => s.id === selectedSubunitId) ?? focal;
  }, [selectedSubunitId, subunits, focal]);
  const tuningRemote = selectedSubunitId !== null;

  // Phase 18: instrument parameters.
  const { parameters, set: setParameters, saveStatus: paramSaveStatus } =
    useEntityParameters({
      entityId: tuningEntity.id,
      remote: tuningRemote,
      initialParameters:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((tuningEntity as unknown as Record<string, unknown>).parameters as Record<
          string,
          unknown
        >) ?? null,
      initialCategory: tuningEntity.entity_category as string | null,
    });
  const liveThroughput = useMemo(() => computeThroughput(parameters), [parameters]);

  // Phase 43: counterfactual ghost state.
  const [ghostParams, setGhostParams] = useState<InstrumentParameters | null>(
    null,
  );
  useEffect(() => {
    setGhostParams(null);
  }, [tuningEntity.id]);
  const ghostThroughput = useMemo(
    () => (ghostParams ? computeThroughput(ghostParams) : null),
    [ghostParams],
  );
  const focusedReaction = useMemo(() => {
    if (!focusedReactionId) return null;
    return reactions.find((x) => x.id === focusedReactionId) ?? null;
  }, [focusedReactionId, reactions]);
  const focusedReactionEntityIds = focusedReaction?.entity_ids ?? null;
  const focusedReactionProbability = focusedReaction?.probability ?? null;
  const focusedReactionType = focusedReaction?.reaction_type ?? null;

  // Phase 17: fractal breadcrumb. Hero subunits drill into their node labs.
  const breadcrumb = [
    { label: "Universe", href: "/app/lab" },
    { label: space.name },
  ];
  const subunitDrillHref = (e: Entity) =>
    e.space_id && e.id
      ? `/app/space/${e.space_id}/entity/${e.id}/lab`
      : null;
  // Bond partners live in OTHER spaces (they came from cross-space bridges).
  // Phase 25: when the partner row is real (entity_id doesn't start with
  // the synthetic "x-" prefix) we can open its node lab directly. Falls
  // back to the partner space's lab for stub partners we couldn't hydrate.
  const bondDrillHref = (e: Entity) => {
    if (!e.space_id) return null;
    const isStub = typeof e.entity_id === "string" && e.entity_id.startsWith("x-");
    return isStub
      ? `/app/space/${e.space_id}/lab`
      : `/app/space/${e.space_id}/entity/${e.id}/lab`;
  };

  return (
    <div className="relative flex h-full w-full flex-col">
      <LabHeader
        spaceId={space.id}
        spaceName={space.name}
        focal={focal}
        entityCount={subunits.length}
        bondCount={upstreamEdges.length + downstreamEdges.length}
        reactionCount={reactions.length}
        mode={mode}
        onModeChange={setMode}
        breadcrumb={breadcrumb}
        closeHref={
          selectedSubunitId
            ? `/app/space/${space.id}?focus=${selectedSubunitId}&rings=1`
            : `/app/space/${space.id}`
        }
      />

      <div
        className="grid flex-1 overflow-hidden"
        style={{
          gridTemplateColumns: "280px 1fr 320px",
          gap: "1px",
          background: "rgba(148,163,184,0.08)",
        }}
      >
        <LabReagentBay
          focal={focal}
          subunits={subunits}
          upstreamEdges={upstreamEdges}
          downstreamEdges={downstreamEdges}
          hoveredSubunitId={hoveredSubunitId}
          onHoverSubunit={setHoveredSubunitId}
          subunitDrillHref={subunitDrillHref}
          bondDrillHref={bondDrillHref}
          selectedSubunitId={selectedSubunitId}
          onSelectSubunit={setSelectedSubunitId}
        />

        {mode === "structure" && (
          <LabChamber3D
            focal={focal}
            subunits={subunits}
            upstreamPartners={upstreamEdges.map((e) => e.partner)}
            downstreamPartners={downstreamEdges.map((e) => e.partner)}
            hoveredSubunitId={hoveredSubunitId}
            onHoverSubunit={setHoveredSubunitId}
            throughput={liveThroughput}
            focusedReactionEntityIds={focusedReactionEntityIds}
            focusedReactionProbability={focusedReactionProbability}
            focusedReactionType={focusedReactionType}
            selectedSubunitId={selectedSubunitId}
            ghostThroughput={ghostThroughput}
          />
        )}
        {mode === "react" && (
          <LabChamberReact
            spaceId={space.id}
            focal={focal}
            subunits={subunits}
            upstreamPartners={upstreamEdges.map((e) => e.partner)}
            downstreamPartners={downstreamEdges.map((e) => e.partner)}
            tray={reactTray}
            onTrayChange={setReactTray}
          />
        )}
        {mode === "spectrum" && (
          <LabChamberSpectrum focal={focal} subunits={subunits} edges={edges} />
        )}

        <LabAnalysis focal={focal} subunits={subunits} />
      </div>

      <div
        className="grid border-t border-[#94a3b8]/[0.08]"
        style={{
          height: 220,
          gridTemplateColumns: "1fr 340px 280px",
          gap: "1px",
          background: "rgba(148,163,184,0.08)",
        }}
      >
        <LabReactionNetwork
          focal={focal}
          reactions={reactions}
          entitiesByUuid={entitiesByUuid}
          focusedReactionId={focusedReactionId}
          onFocusReaction={setFocusedReactionId}
        />
        <LabDistribution parameters={parameters} />
        <LabControlPanel
          parameters={parameters}
          onChange={setParameters}
          saveStatus={paramSaveStatus}
          tuningTargetName={tuningEntity.name}
          tuningSubunitSelected={selectedSubunitId !== null}
          onClearTuningTarget={() => setSelectedSubunitId(null)}
          tuningCategory={tuningEntity.entity_category as string | null}
          ghostParams={ghostParams}
          onGhostParamsChange={setGhostParams}
        />
      </div>

      <style jsx global>{`
        @keyframes lab-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
