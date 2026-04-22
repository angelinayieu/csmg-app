"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { Entity, Edge } from "@/types";
import type { Reaction } from "@/types/reactions";
import { LabHeader } from "./lab-header";
import { LabReagentBay } from "./lab-reagent-bay";
import { LabBuildConnections } from "./lab-build-connections";
import { LabChamberReact } from "./lab-chamber-react";
import { LabChamberSpectrum } from "./lab-chamber-spectrum";
import { LabChamberProximity } from "./lab-chamber-proximity";
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

// Phase 14 — 3D chamber is dynamic-imported so Three.js (~600KB) ships
// only with the lab route, not the canvas bundle. SSR off: Three touches
// window/WebGL. A small spinner holds the center column during hydration.
const LabChamber3D = dynamic(() => import("./lab-chamber-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[var(--lab-bg)]">
      <div className="flex items-center gap-2 text-[11px] text-[var(--lab-accent)]/80">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Initializing reactor chamber…
      </div>
    </div>
  ),
});

export interface NodeLabProps {
  spaceId: string;
  spaceName: string;
  focal: Entity;
  entities: Entity[];
  edges: Edge[];
  reactions: Reaction[];
}

function parentIdOf(e: Entity): string | null {
  const prov = e.provenance as
    | { parent_entity_id?: string | null }
    | null
    | undefined;
  if (!prov || typeof prov !== "object") return null;
  return prov.parent_entity_id ?? null;
}

export function NodeLab({
  spaceId,
  spaceName,
  focal,
  entities,
  edges,
  reactions,
}: NodeLabProps) {
  // Resolve subunits = entities whose provenance.parent_entity_id === focal.id
  const subunits = useMemo<Entity[]>(
    () => entities.filter((e) => parentIdOf(e) === focal.id),
    [entities, focal.id],
  );

  // Build entity lookup for up/downstream partner + reaction participant resolution
  const entitiesByUuid = useMemo<Map<string, Entity>>(() => {
    const m = new Map<string, Entity>();
    for (const e of entities) m.set(e.id, e);
    return m;
  }, [entities]);

  // Split edges by direction relative to focal
  const { upstreamEdges, downstreamEdges } = useMemo(() => {
    const up: Array<{ edge: Edge; partner: Entity }> = [];
    const down: Array<{ edge: Edge; partner: Entity }> = [];
    for (const edge of edges) {
      if (edge.source_entity_id === focal.id) {
        const p = entitiesByUuid.get(edge.target_entity_id);
        if (p) down.push({ edge, partner: p });
      } else if (edge.target_entity_id === focal.id) {
        const p = entitiesByUuid.get(edge.source_entity_id);
        if (p) up.push({ edge, partner: p });
      }
    }
    return { upstreamEdges: up, downstreamEdges: down };
  }, [edges, focal.id, entitiesByUuid]);

  const [hoveredSubunitId, setHoveredSubunitId] = useState<string | null>(null);
  const [mode, setMode] = useState<LabMode>("structure");
  const [reactTray, setReactTray] = useState<string[]>([]);
  // Phase 27: focusedReactionId + selectedSubunitId are URL-backed so lab
  // views are shareable (`?rxn=...&tune=...`).
  const {
    focusedReactionId,
    setFocusedReactionId,
    selectedSubunitId,
    setSelectedSubunitId,
  } = useLabUrlState();

  // Phase 21: which entity is the control panel currently tuning?
  const tuningEntity = useMemo<Entity>(() => {
    if (!selectedSubunitId) return focal;
    return subunits.find((s) => s.id === selectedSubunitId) ?? focal;
  }, [selectedSubunitId, subunits, focal]);

  // Phase 18: instrument parameters + Monte Carlo throughput.
  // Phase 21: target switches to selected subunit when one is tuned. Both
  // focal entities and proxy-indicator subunits are real DB rows, so
  // persistence is on for both.
  const { parameters, set: setParameters, saveStatus: paramSaveStatus } =
    useEntityParameters({
      entityId: tuningEntity.id,
      remote: true,
      initialParameters:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((tuningEntity as unknown as Record<string, unknown>).parameters as Record<
          string,
          unknown
        >) ?? null,
      initialCategory: (tuningEntity.entity_category as string | null) ?? null,
    });
  // Phase 19: live throughput driven by parameters; piped into chamber HUD.
  const liveThroughput = useMemo(() => computeThroughput(parameters), [parameters]);

  // Phase 43: counterfactual ghost state. Owned here so the chamber and
  // the Control Panel share it without a ref dance. Resets whenever the
  // tuning target changes (otherwise a ghost for entity A would leak
  // into entity B after a subunit selection).
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

  // Phase 20: derive entity ids from the focused reaction so the chamber
  // can light up the participant subunits and stream particles to them.
  // Phase 23: also surface the reaction's probability so particle density
  // scales with reaction strength.
  const focusedReaction = useMemo(() => {
    if (!focusedReactionId) return null;
    return reactions.find((x) => x.id === focusedReactionId) ?? null;
  }, [focusedReactionId, reactions]);
  const focusedReactionEntityIds = focusedReaction?.entity_ids ?? null;
  const focusedReactionProbability = focusedReaction?.probability ?? null;
  const focusedReactionType = focusedReaction?.reaction_type ?? null;

  // Phase 17: fractal breadcrumb + drill-in navigation.
  const breadcrumb = [
    { label: "Universe", href: "/app/lab" },
    { label: spaceName, href: `/app/space/${spaceId}/lab` },
    { label: focal.name },
  ];
  const subunitDrillHref = (e: Entity) =>
    e.space_id && e.id && !e.id.startsWith("x-")
      ? `/app/space/${e.space_id}/entity/${e.id}/lab`
      : null;
  const bondDrillHref = (e: Entity) =>
    e.space_id && e.id && !e.id.startsWith("x-")
      ? `/app/space/${e.space_id}/entity/${e.id}/lab`
      : null;

  return (
    <div className="relative flex h-full w-full flex-col">
      <LabHeader
        spaceId={spaceId}
        spaceName={spaceName}
        focal={focal}
        entityCount={subunits.length}
        bondCount={upstreamEdges.length + downstreamEdges.length}
        reactionCount={reactions.length}
        mode={mode}
        onModeChange={setMode}
        breadcrumb={breadcrumb}
        closeHref={`/app/space/${spaceId}/whiteboard?focus=${focal.id}&rings=1`}
      />

      {/* Main 3-column surface */}
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
          subunitsEmptyAction={
            <LabBuildConnections spaceId={spaceId} entityId={focal.id} variant="full" />
          }
          subunitsSectionAction={
            <LabBuildConnections spaceId={spaceId} entityId={focal.id} variant="mini" />
          }
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
            spaceId={spaceId}
            focal={focal}
            subunits={subunits}
            upstreamPartners={upstreamEdges.map((e) => e.partner)}
            downstreamPartners={downstreamEdges.map((e) => e.partner)}
            tray={reactTray}
            onTrayChange={setReactTray}
          />
        )}
        {mode === "spectrum" && (
          <LabChamberSpectrum
            focal={focal}
            subunits={subunits}
            edges={edges}
          />
        )}
        {mode === "proximity" && (
          <LabChamberProximity
            spaceId={spaceId}
            focal={focal}
          />
        )}

        <LabAnalysis focal={focal} subunits={subunits} spaceId={spaceId} />
      </div>

      {/* Footer: Reaction network · Distribution · Control panel (Phase 18) */}
      <div
        className="grid border-t border-[var(--lab-border)]"
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

      {/* Shared keyframes (global so child components like LabHeader can use them) */}
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
