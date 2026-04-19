"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { Space, Entity, Edge, Bridge } from "@/types";
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
        Initializing universal reactor…
      </div>
    </div>
  ),
});

export interface UniversalLabProps {
  spaces: Space[];
  entities: Entity[];
  edges: Edge[];
  reactions: Reaction[];
  bridges: Bridge[];
  /** Reactions save here (user's most-recent space). Matches Universal Canvas. */
  writeTargetSpace: Space;
}

/**
 * Synthesizes a "universe" Entity that represents the user's full
 * cross-space knowledge body.
 */
function synthesizeUniverseAsEntity(spaces: Space[], entities: Entity[]): Entity {
  const avgConfidence = entities.length > 0
    ? entities.reduce((s, e) => s + ((e.confidence as number) ?? 0.7), 0) / entities.length
    : 0.8;
  const leverageCount = entities.filter((e) => e.is_leverage_point).length;
  const universeId = "universe";
  return {
    id: universeId,
    space_id: spaces[0]?.id ?? universeId,
    entity_id: "UNIVERSE",
    name: `Universe · ${spaces.length} spaces`,
    description: `Cross-space knowledge reactor. ${entities.length} entities, ${leverageCount} leverage points, across ${spaces.length} spaces.`,
    source_tag: "explicit",
    entity_type: "universe",
    entity_category: "abstract",
    layer: "system",
    depth: 0,
    importance: "fundamental",
    confidence: avgConfidence,
    is_leverage_point: leverageCount > 0,
    is_risk_point: false,
    blast_radius: entities.length,
    centrality_rank: 0,
    is_shared_variable: true,
    is_decomposable: true,
    is_master_bottleneck: false,
    has_sub_space: false,
    sub_space_id: null,
    graph_x: null,
    graph_y: null,
    knowledge_layer: "internal",
    provenance: {
      source_type: "universal_lab",
      space_count: spaces.length,
      entity_count: entities.length,
      leverage_count: leverageCount,
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
 * Converts each Space into an Entity-shaped "subunit" so the existing
 * reagent bay + chamber can render it. UUID = space.id so the reagent
 * bay rows deep-link back to their space lab.
 */
function spacesAsSubunits(spaces: Space[], entities: Entity[]): Entity[] {
  // Group entities by space for per-space stats
  const entitiesBySpace = new Map<string, Entity[]>();
  for (const e of entities) {
    if (!entitiesBySpace.has(e.space_id)) entitiesBySpace.set(e.space_id, []);
    entitiesBySpace.get(e.space_id)!.push(e);
  }

  return spaces.map((s) => {
    const spaceEntities = entitiesBySpace.get(s.id) ?? [];
    const avgConf = spaceEntities.length > 0
      ? spaceEntities.reduce((sum, e) => sum + ((e.confidence as number) ?? 0.7), 0) /
        spaceEntities.length
      : 0.7;
    const hasLeverage = spaceEntities.some((e) => e.is_leverage_point);
    return {
      id: s.id,
      space_id: s.id,
      entity_id: s.space_prefix ?? s.name.slice(0, 3).toUpperCase(),
      name: s.name,
      description:
        s.description ??
        `${spaceEntities.length} entities${hasLeverage ? " · leverage-bearing" : ""}`,
      source_tag: "explicit",
      entity_type: "space",
      entity_category: "abstract",
      layer: "domain", // depth 1 — a space sits one level below the universe
      depth: 1,
      importance: hasLeverage ? "critical" : "important",
      confidence: avgConf,
      is_leverage_point: hasLeverage,
      is_risk_point: false,
      blast_radius: spaceEntities.length,
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
        source_type: "universal_lab",
        space_id: s.id,
        entity_count: spaceEntities.length,
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
  });
}

/**
 * Cross-space bridges become intra-universe edges between space-subunits.
 * Strong bridges = higher strength. All bridges read as "internal" bonds
 * since both endpoints are inside the universe.
 */
function bridgesAsInternalEdges(
  bridges: Bridge[],
  spaceSubunitIds: Set<string>,
): Array<{ edge: Edge; partner: Entity }> {
  const out: Array<{ edge: Edge; partner: Entity }> = [];
  void out;
  // Not used directly — universe lab doesn't split into up/down since all
  // bridges are internal. We return them via a parallel helper below.
  return out;
}
void bridgesAsInternalEdges;

export function UniversalLab({
  spaces,
  entities,
  edges,
  reactions,
  bridges,
  writeTargetSpace,
}: UniversalLabProps) {
  const focal = useMemo(() => synthesizeUniverseAsEntity(spaces, entities), [spaces, entities]);
  const subunits = useMemo(() => spacesAsSubunits(spaces, entities), [spaces, entities]);

  // Build entity-by-uuid lookup including: synthesized universe, synthesized
  // space-subunits, and every real entity across every space. The React-mode
  // palette pulls from all of these.
  const entitiesByUuid = useMemo(() => {
    const m = new Map<string, Entity>();
    m.set(focal.id, focal);
    for (const s of subunits) m.set(s.id, s);
    for (const e of entities) m.set(e.id, e);
    return m;
  }, [focal, subunits, entities]);

  const subunitIds = useMemo(() => new Set(subunits.map((s) => s.id)), [subunits]);

  // Bridges between space-subunits render as "upstream" edges in the
  // reagent bay so users can see WHICH spaces this universe is bridging.
  // Direction doesn't really apply at this scale — we put them all in
  // one bucket and label by shared variable.
  const bridgeEdgesUp = useMemo(() => {
    return bridges
      .map((b) => {
        const partnerId = subunitIds.has(b.source_space_id)
          ? b.target_space_id
          : b.source_space_id;
        const partner = entitiesByUuid.get(partnerId);
        if (!partner) return null;
        const pseudoEdge: Edge = {
          id: `ubridge-${b.id}`,
          space_id: focal.id,
          source_entity_id: b.source_space_id,
          target_entity_id: b.target_space_id,
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
        return { edge: pseudoEdge, partner };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [bridges, subunitIds, entitiesByUuid, focal.id]);

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

  // Phase 21: which subunit is being tuned. Universal Lab's space-subunits
  // are synthesized (no real entity row), so we run in-memory always.
  const tuningEntity = useMemo<Entity>(() => {
    if (!selectedSubunitId) return focal;
    return subunits.find((s) => s.id === selectedSubunitId) ?? focal;
  }, [selectedSubunitId, subunits, focal]);

  // Phase 18: instrument parameters. Universe focal + space subunits are
  // synthetic — in-memory only across the board.
  const { parameters, set: setParameters, saveStatus: paramSaveStatus } =
    useEntityParameters({
      entityId: tuningEntity.id,
      remote: false,
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

  // Phase 17: top of the fractal hierarchy. Each space-subunit drills
  // into its own space lab; bond partners (cross-space entities) drill
  // to their space lab or node lab where resolvable.
  const breadcrumb = [{ label: "Universe" }];
  const subunitDrillHref = (e: Entity) =>
    e.entity_type === "space" && e.id ? `/app/space/${e.id}/lab` : null;
  const bondDrillHref = (e: Entity) =>
    e.space_id && e.id && !e.id.startsWith("x-")
      ? `/app/space/${e.space_id}/entity/${e.id}/lab`
      : e.space_id
        ? `/app/space/${e.space_id}/lab`
        : null;

  return (
    <div className="relative flex h-full w-full flex-col">
      <LabHeader
        spaceId={writeTargetSpace.id}
        spaceName={`Universe · writing to ${writeTargetSpace.name}`}
        focal={focal}
        entityCount={subunits.length}
        bondCount={bridgeEdgesUp.length}
        reactionCount={reactions.length}
        mode={mode}
        onModeChange={setMode}
        breadcrumb={breadcrumb}
        closeHref="/app"
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
          upstreamEdges={bridgeEdgesUp}
          downstreamEdges={[]}
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
            upstreamPartners={bridgeEdgesUp.map((e) => e.partner)}
            downstreamPartners={[]}
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
            spaceId={writeTargetSpace.id}
            focal={focal}
            subunits={subunits}
            upstreamPartners={bridgeEdgesUp.map((e) => e.partner)}
            downstreamPartners={[]}
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
