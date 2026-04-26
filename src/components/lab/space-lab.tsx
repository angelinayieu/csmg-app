"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { Entity, Edge, Bridge, Space } from "@/types";
import type { Reaction } from "@/types/reactions";
import type { System } from "@/types/system";
import { LabHeader } from "./lab-header";
import { LabReagentBay } from "./lab-reagent-bay";
import { LabChamberReact } from "./lab-chamber-react";
import { LabChamberSpectrum } from "./lab-chamber-spectrum";
import { LabAnalysis } from "./lab-analysis";
import { LabReactionNetwork } from "./lab-reaction-network";
import { LabControlPanel } from "./lab-control-panel";
import { LabDistribution } from "./lab-distribution";
import { CalibrationStatusStrip } from "./calibration-status-strip";
import { CalibrationReviewGapsDrawer } from "./calibration-review-gaps-drawer";
import { summarizeCalibration, type CalibrationSummary } from "@/types/simulation-mode";
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
    <div className="flex h-full items-center justify-center bg-[var(--lab-bg)]">
      <div className="flex items-center gap-2 text-[11px] text-[var(--lab-accent)]/80">
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
  /**
   * Phase 5 — when present, the lab page narrowed `entities` and
   * `edges` to this saved System's contents. The component uses this
   * only to render a "Scoped to: <name>" pill so users understand
   * why the chamber is scoped down (and offers a 1-click escape back
   * to the whole-space lab).
   */
  scopedSystem?: System | null;
  /**
   * A/B comparator (Phase 5 follow-on) — when present, the user has
   * paired two systems via `?systemId=A&systemB=B`. The lab still
   * renders only the active scopedSystem (real split-screen is a
   * future pass) but exposes a "Swap to: B" pill so users can ping-
   * pong between the two without re-navigating.
   */
  comparedSystem?: System | null;
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
  scopedSystem,
  comparedSystem,
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

  // Gap B — pull the latest RealityCalibration so the strip shows a
  // real verdict instead of the `unknown` stub. Fire once on mount;
  // re-fetches on space id change (user navigates between spaces) or
  // after a bypass flip. Soft-fail to `summarizeCalibration(0, 0)` so
  // the strip is never absent — the UI's honesty contract needs the
  // strip mounted even when the endpoint times out.
  const [calibration, setCalibration] = useState<CalibrationSummary>(() =>
    summarizeCalibration(0, 0),
  );
  const [calibrationBump, setCalibrationBump] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/lab/calibration?space_id=${encodeURIComponent(space.id)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { summary?: CalibrationSummary };
        if (cancelled || !body.summary) return;
        setCalibration(body.summary);
      } catch (err) {
        console.warn("[space-lab] calibration fetch failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [space.id, calibrationBump]);
  const handleBypass = async () => {
    try {
      await fetch("/api/lab/calibration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space_id: space.id, bypass: true }),
      });
      setCalibrationBump((n) => n + 1);
    } catch (err) {
      console.warn("[space-lab] bypass failed:", err);
    }
  };
  // Gap B — re-run calibration against current KG state. Fires after
  // the user fixes blocker entities surfaced by the review-gaps drawer.
  // The route returns the new summary synchronously, so we update
  // optimistically from the response instead of round-tripping through
  // calibrationBump (faster + avoids a visible flash-to-previous-state).
  const [recomputing, setRecomputing] = useState(false);
  const handleRecompute = async () => {
    if (recomputing) return;
    setRecomputing(true);
    try {
      const res = await fetch("/api/lab/calibration/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space_id: space.id }),
      });
      if (res.ok) {
        const body = (await res.json()) as { summary?: CalibrationSummary };
        if (body.summary) setCalibration(body.summary);
      } else {
        console.warn("[space-lab] recompute returned", res.status);
      }
    } catch (err) {
      console.warn("[space-lab] recompute failed:", err);
    } finally {
      setRecomputing(false);
    }
  };
  // Gap B — review gaps drawer visibility. The drawer fetches its own
  // data; this flag just opens/closes it.
  const [reviewGapsOpen, setReviewGapsOpen] = useState(false);
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
            ? `/app/space/${space.id}/whiteboard?focus=${selectedSubunitId}&rings=1`
            : `/app/space/${space.id}/whiteboard`
        }
      />

      {/* Phase 5 — scoped-to-system pill. Tells users why the chamber
          may look smaller than the whole-space lab and offers a
          one-click escape back to the unscoped view. Renders nothing
          when not scoped. */}
      {scopedSystem && (
        <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.08)] bg-[rgba(124,58,237,0.10)] px-4 py-1.5 text-[11px] text-violet-200">
          <span className="font-bold uppercase tracking-[0.14em]">Scoped</span>
          <span className="text-violet-300">·</span>
          <span className="font-medium text-violet-100">
            {scopedSystem.name}
          </span>
          <span className="text-violet-400">·</span>
          <span className="font-mono tabular-nums text-violet-300">
            {scopedSystem.entity_count} entit
            {scopedSystem.entity_count === 1 ? "y" : "ies"} ·{" "}
            {scopedSystem.edge_count} edge
            {scopedSystem.edge_count === 1 ? "" : "s"}
          </span>
          {scopedSystem.is_complex && (
            <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-200">
              complex
            </span>
          )}
          {scopedSystem.is_probabilistic && (
            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-200">
              probabilistic
            </span>
          )}
          {scopedSystem.is_open && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200">
              open
            </span>
          )}
          <a
            href={`/app/space/${space.id}/lab`}
            className="ml-auto rounded border border-violet-300/30 px-2 py-0.5 text-[10px] font-medium text-violet-100 transition hover:bg-violet-500/20"
            title="Exit scoped view — return to whole-space lab"
          >
            Whole space
          </a>
          <a
            href={`/app/space/${space.id}/systems/${scopedSystem.id}`}
            className="rounded border border-violet-300/30 px-2 py-0.5 text-[10px] font-medium text-violet-100 transition hover:bg-violet-500/20"
            title="Open system detail page"
          >
            Inspect
          </a>
        </div>
      )}

      {/* A/B comparator — when paired with another system, surface a
          one-click swap so the user can ping-pong between them while
          running the same scenario manually in each. Real split-
          screen comparator is a future pass; for now this is the
          navigational substrate that establishes the pair. */}
      {scopedSystem && comparedSystem && (
        <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.08)] bg-[rgba(8,145,178,0.10)] px-4 py-1 text-[11px] text-cyan-200">
          <span className="font-bold uppercase tracking-[0.14em]">A/B</span>
          <span className="text-cyan-300">·</span>
          <span className="font-medium text-cyan-100">
            comparing with{" "}
            <strong className="text-cyan-50">{comparedSystem.name}</strong>{" "}
            ({comparedSystem.entity_count} entities)
          </span>
          <a
            href={`/app/space/${space.id}/lab?systemId=${comparedSystem.id}&systemB=${scopedSystem.id}`}
            className="ml-auto inline-flex items-center gap-1 rounded border border-cyan-300/30 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
            title="Swap which system is the active scope"
          >
            ⇄ Swap active
          </a>
          <a
            href={`/app/space/${space.id}/lab?systemId=${scopedSystem.id}`}
            className="rounded border border-cyan-300/30 px-2 py-0.5 text-[10px] font-medium text-cyan-100 transition hover:bg-cyan-500/20"
            title="Exit comparison"
          >
            ✕ Unpair
          </a>
        </div>
      )}

      {/* Gap B — calibration gate. Today the `reality-calibration`
          pipeline stage doesn't exist yet, so we seed the strip with
          an "unknown" summary (no baselines declared → soft neutral
          note). When the stage lands it will emit a
          CalibrationSummary per space and this mount point pulls it
          from the space row. The strip itself is epistemically
          authoritative: until it turns emerald, any proposal built
          on lab results is unverified. */}
      <div className="px-3 pb-1 pt-2">
        <CalibrationStatusStrip
          summary={calibration}
          onReviewGaps={
            // Review gaps is meaningful only when there are gaps to
            // review. Unknown (no baselines) and calibrated (all pass)
            // have nothing to show.
            calibration.status === "uncalibrated" ||
            calibration.status === "partial" ||
            calibration.status === "bypassed"
              ? () => setReviewGapsOpen(true)
              : undefined
          }
          onBypass={
            // Only surface "run anyway" when there's a real failure to
            // bypass. An unknown/calibrated state doesn't need the
            // escape hatch.
            calibration.status === "uncalibrated" ||
            calibration.status === "partial"
              ? handleBypass
              : undefined
          }
          onRecompute={
            // Re-run makes sense in any state where a KG fix could
            // flip the verdict. `unknown` has no baselines to check;
            // `calibrated` is already green and a recompute just
            // spends an LLM call to confirm the status quo.
            calibration.status === "uncalibrated" ||
            calibration.status === "partial" ||
            calibration.status === "bypassed"
              ? handleRecompute
              : undefined
          }
          recomputing={recomputing}
          dense
        />
      </div>

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

      {/* Gap B — review gaps drawer. Mounted last so it overlays the lab
          chamber when open. Closed state returns null so there's no
          cost when it's not visible. Focus handler hooks blocker chips
          into the reagent bay's selection so the user can jump from
          "this baseline is off because of entity X" straight to tuning X. */}
      <CalibrationReviewGapsDrawer
        open={reviewGapsOpen}
        onClose={() => setReviewGapsOpen(false)}
        spaceId={space.id}
        entitiesByUuid={entitiesByUuid}
        onFocusEntity={(entityId) => {
          // If the blocker is one of the hero subunits, select it so the
          // control panel tunes it and the reagent bay highlights it.
          // Otherwise this is a best-effort close-the-drawer — cross-space
          // / bridge entities don't have a local selection surface yet.
          const isSubunit = subunits.some((s) => s.id === entityId);
          if (isSubunit) {
            setSelectedSubunitId(entityId);
          } else {
            setHoveredSubunitId(entityId);
          }
          setReviewGapsOpen(false);
        }}
      />

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
