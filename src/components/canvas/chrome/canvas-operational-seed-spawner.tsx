"use client";

// ── Canvas operational-view seeder ───────────────────────────────
//
// On canvas mount, reconstructs the persistent OPERATIONAL shapes
// from durable data so users opening a space — including those
// returning days later, or opening a space approved before A1
// landed — see the system view immediately, not an empty canvas.
//
// Why this is separate from the pipeline event painter:
//   The painter only fires DURING a run (SSE events). Once the run
//   completes, those shapes survive (post-A1) but if the user never
//   reloads while a run was active, OR if they're returning to a
//   space from before A1, the canvas comes up empty. This spawner
//   reads the durable data sources and recreates the missing shapes.
//
// Idempotency contract (matches CanvasKgOverviewSpawner +
// interaxis-canvas's app-card auto-cascade):
//   - Each shape uses a deterministic id keyed on (kind + spaceId)
//   - If the shape already exists in the tldraw store, skip
//   - localStorage flag also gates a "spawn once per (space, kind)"
//     so a user who deletes the card sees it stay gone — respecting
//     their dismiss intent across sessions
//   - Soft-fail throughout: a fetch error in one shape doesn't block
//     the others
//
// Targets (this spawner):
//   • room-shape × 8       — pre-spawned for the full operational cascade
//                            (intake / landscape / kg / proposal / twin /
//                            lab / reflexive / results); each pinned to
//                            back so artifact cards float INSIDE.
//   • room-transition × 7  — directional dashed connectors between
//                            adjacent rooms.
//   • layer-stack          — from /api/spaces/[id]/layer-ontology, one
//                            vertical stack at the left edge of the kg
//                            room showing the domain's layer hierarchy
//                            (e.g. Cognitive Performance: Exogenous →
//                            Composite). Skipped for spaces without an
//                            ontology declared.
//   • strategy-hero-card   — from synthesis_data.strategic_recommendation.ranked_strategies,
//                            anchored centered inside the proposal room.
//   • hypothesis-ladder × N — from /api/spaces/[id]/hypothesis-ladders
//                            (capped 4), anchored as a horizontal strip
//                            below the strategy-hero. Surfaces the
//                            strategy's pre_mortem entries as 4-rung
//                            (claim → mechanism → falsifier → verdict)
//                            cards so users see the falsifiable claims
//                            their strategy implicitly rests on.
//   • twin-snapshot        — from /api/spaces/[id]/twin-state, anchored
//                            centered inside the twin room.
//   • mechanism-card × N   — from /api/spaces/[id]/mechanisms (capped 5),
//                            anchored as a horizontal strip inside the
//                            twin room, just right of the twin-snapshot.
//                            Surfaces cycle pattern + agent count + app
//                            count + status per mechanism.
//   • trajectory-fan × N   — from /api/spaces/[id]/trajectories (capped 3),
//                            anchored BELOW the mechanism row in the twin
//                            room. Renders prediction_ledger trajectory
//                            rows as compact p10/p50/p90 fan charts so
//                            the simulator's forecast lives next to the
//                            twin-snapshot instead of buried in the
//                            standalone TrajectoryPanel side-page.
//   • synthesis-card × N   — from /api/spaces/[id]/synthesis-insights (one
//                            "risk" card for the master bottleneck + top
//                            2 leverage cards + top 1 risk card), laid out
//                            as a horizontal row inside the kg room.
//   • forest-plot          — singleton from /api/spaces/[id]/forest-plot
//                            (capped 8 findings inside the card itself),
//                            anchored below the synthesis insights row.
//                            Renders evidence_registries effect sizes
//                            with confidence intervals as the canonical
//                            meta-analysis viz.
//   • edge-drift-heatmap   — singleton from /api/spaces/[id]/edge-drift
//                            (top 8 edges × last 6 weeks), anchored
//                            inside the reflexive room. Visualizes which
//                            edges drifted, in which direction, and how
//                            recently — the audit-room counterpart to
//                            the trajectory fan + forest plot.
//
// Live updates:
//   • Room subtitles refresh in place when /api/spaces/[id]/room-counts
//     resolves post-spawn (A5). The spawn loop uses an inline fetch for
//     initial subtitles; the dedicated useEffect at the bottom of this
//     file watches useRoomCounts(spaceId) for any subsequent count
//     changes and updateShapes each room.
//
// Future targets (next tickets):
//   • app cards inside the lab room (auto-paint already exists; need
//     spawner pass for spaces whose run completed pre-A1)
//   • reflexive pulse widget (always-on bottom-right)
//   • persona → strategy connectors

import { useEffect } from "react";
import { createShapeId, useEditor } from "tldraw";
import type {
  StrategyHeroCardShape,
  TwinSnapshotShape,
  SynthesisCardShape,
  RoomShape,
  LayerStackShape,
  LearningLoopCardShape,
  CycleLoopShape,
} from "../shapes/types";
import {
  STRATEGY_HERO_DEFAULT_W,
  STRATEGY_HERO_DEFAULT_H,
} from "../shapes/strategy-hero-card-shape";
import {
  LEARNING_LOOP_DEFAULT_W,
  LEARNING_LOOP_DEFAULT_H,
} from "../shapes/learning-loop-card-shape";
import {
  STAGE_ROOMS,
  STAGE_HEIGHT,
  ROOM_W,
  computeRoomBounds,
  placeCenteredInsideRoom,
  buildRoomSubtitle,
  EMPTY_ROOM_COUNTS,
  type RoomCounts,
} from "@/lib/whiteboard/room-layout";
import type { PipelineStage } from "@/types/pipeline-events";
import type { TwinMacroState } from "@/types/twin";
import { useRoomCounts } from "@/lib/hooks/use-room-counts";

// Wait long enough that the KG-overview spawner + subject-card hydrator
// have a chance to land first. Same delay constant pattern as
// canvas-kg-overview-spawner.tsx.
const POLL_DELAY_MS = 800;

// All seeded shapes are positioned INSIDE their owning rooms via
// placeCenteredInsideRoom(). The room layout module owns the
// canonical y-bands for each stage; the seeder + the live painter
// share that helper so room-pre-spawn here aligns perfectly with
// painter shapes that arrive during a live run.
//
// Anchor: origin (0, 0). Same anchor the existing painter uses on
// fresh runs and that the kg-overview-spawner places its card at.
const SEED_ANCHOR = { x: 0, y: 0 } as const;

const TWIN_SNAP_W = 360;
const TWIN_SNAP_H = 320;

const SYNTH_CARD_W = 280;
const SYNTH_CARD_H = 160;
const SYNTH_GAP = 24;
// Top 2 leverage cards + top 1 risk card alongside the bottleneck =
// up to 4 cards in the kg room.
const SYNTH_MAX_LEVERAGE = 2;
const SYNTH_MAX_RISK = 1;

interface OperationalSeedSpawnerProps {
  spaceId: string;
  /** Optional fallback space name. The /twin-state response carries the
   *  authoritative name; this only matters if that endpoint omits it. */
  spaceName?: string;
}

export function CanvasOperationalSeedSpawner({
  spaceId,
  spaceName = "",
}: OperationalSeedSpawnerProps) {
  const editor = useEditor();

  // A5 — live room subtitles. The hook fetches per-stage counts once
  // on mount (entities, edges, cycles, axes, proposals, variants,
  // bridges, assets, predictions). The first effect below uses these
  // for INITIAL spawn subtitles via an inline fetch (so the loop
  // doesn't race the hook's async resolution); the second effect
  // refreshes existing room subtitles when the hook's counts arrive
  // after the spawn completes.
  const { counts: liveCounts } = useRoomCounts(spaceId);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;

    const flagKey = (kind: string) =>
      `interaxis:auto_placed_op:${spaceId}:${kind}`;
    const flag = (key: string) =>
      typeof window !== "undefined"
        ? window.localStorage.getItem(key) === "1"
        : false;
    const setFlag = (key: string) => {
      if (typeof window !== "undefined") window.localStorage.setItem(key, "1");
    };

    const t = setTimeout(() => {
      if (cancelled) return;

      void (async () => {
        // ── 0. Pre-spawn the 8 stage rooms ─────────────────────
        // Room shapes are the visual backdrop that turns the canvas
        // into a top-down operational flowchart (intake → landscape
        // → kg → proposal → twin → lab → reflexive → results). The
        // live painter spawns these on first event of each stage
        // during a run; this seeder pre-places them so users opening
        // a space whose run has finished STILL see the architecture,
        // and so the artifact-card spawns below have rooms to anchor
        // into.
        //
        // Idempotency: deterministic shape id per (spaceId, stage).
        // localStorage flag is per-stage so dismissing one room
        // doesn't suppress the others.
        //
        // A5 — fetch real counts upfront so the room subtitles read
        // "202 entities · 268 edges · 1 cycle" instead of "Reading
        // your prompt…". Inline fetch here (rather than relying on
        // the hook) because the spawn loop runs synchronously in
        // this setTimeout closure and can't await the hook's
        // useEffect-driven resolution. The hook drives the
        // post-spawn refresh effect below for any subsequent count
        // updates.
        let initialCounts: RoomCounts = EMPTY_ROOM_COUNTS as RoomCounts;
        try {
          const countsRes = await fetch(
            `/api/spaces/${encodeURIComponent(spaceId)}/room-counts`,
          );
          if (countsRes.ok && !cancelled) {
            const json = (await countsRes.json()) as {
              counts?: RoomCounts;
            };
            if (json?.counts) initialCounts = json.counts;
          }
        } catch {
          /* non-fatal — fall back to empty counts; the live-update
             effect will fix subtitles once the hook resolves */
        }
        if (cancelled) return;

        for (const stage of Object.keys(STAGE_ROOMS) as PipelineStage[]) {
          if (cancelled) break;
          const roomFlagK = flagKey(`room-${stage}`);
          const roomShapeId = createShapeId(`room-${spaceId}-${stage}`);
          if (editor.getShape(roomShapeId)) {
            setFlag(roomFlagK);
            continue;
          }
          if (flag(roomFlagK)) continue;
          try {
            const bounds = computeRoomBounds(stage, SEED_ANCHOR);
            // Real counts subtitle (e.g. "202 entities · 268 edges ·
            // 1 cycle"). The painter overrides this when a live run
            // lands events in this stage; the live-update effect
            // below also refreshes when counts change post-spawn.
            const subtitle = buildRoomSubtitle(stage, initialCounts);
            editor.markHistoryStoppingPoint(
              `auto-place-room-${stage}-${spaceId}`,
            );
            editor.createShape<RoomShape>({
              id: roomShapeId,
              type: "room",
              x: bounds.x,
              y: bounds.y,
              props: {
                w: ROOM_W,
                h: STAGE_HEIGHT[stage],
                stage,
                state: "pending",
                subtitle,
                pulse: 0,
                spawnedAt: Date.now(),
                spaceId,
              },
              meta: { source: "operational-seeder:room" },
            });
            // Send rooms to back so artifact cards visually float
            // inside them rather than getting clipped.
            editor.sendToBack([roomShapeId]);
            setFlag(roomFlagK);
          } catch (err) {
            console.warn(
              `[operational-seeder] room ${stage} spawn failed:`,
              err,
            );
          }
        }

        if (cancelled) return;

        // ── 0b. Spawn connectors between adjacent rooms ─────────
        // Vertical dashed arrows linking each room to its successor
        // (intake → landscape → kg → proposal → twin → lab →
        // reflexive → results) — turns the canvas from a stack of
        // independent rooms into a directional cascade. Tldraw
        // bindings (terminal start/end on the room shapes) mean the
        // arrows follow if a room is ever repositioned.
        //
        // Color: tldraw "grey" — a single neutral keeps the visual
        // hierarchy on the rooms (which already carry stage accents
        // via the room shape's left bar) instead of fighting them
        // with N more colors. Style: dashed elbow, arrowhead at end.
        const orderedStages = (
          Object.keys(STAGE_ROOMS) as PipelineStage[]
        ).sort((a, b) => STAGE_ROOMS[a].order - STAGE_ROOMS[b].order);
        for (let i = 0; i < orderedStages.length - 1; i++) {
          if (cancelled) break;
          const fromStage = orderedStages[i];
          const toStage = orderedStages[i + 1];
          const connectorFlagK = flagKey(`connector-${fromStage}-${toStage}`);
          const connectorShapeId = createShapeId(
            `room-connector-${spaceId}-${fromStage}-${toStage}`,
          );
          if (editor.getShape(connectorShapeId)) {
            setFlag(connectorFlagK);
            continue;
          }
          if (flag(connectorFlagK)) continue;

          const fromRoomId = createShapeId(`room-${spaceId}-${fromStage}`);
          const toRoomId = createShapeId(`room-${spaceId}-${toStage}`);
          // If either anchor room hasn't materialized (e.g., the
          // user dismissed it), skip this connector — a one-end
          // arrow would render as a stub.
          if (!editor.getShape(fromRoomId) || !editor.getShape(toRoomId)) {
            continue;
          }

          try {
            editor.markHistoryStoppingPoint(
              `auto-place-room-connector-${fromStage}-${toStage}-${spaceId}`,
            );
            editor.createShape({
              id: connectorShapeId,
              type: "arrow",
              props: {
                color: "grey",
                size: "m",
                font: "sans",
                dash: "dashed",
                kind: "elbow",
                arrowheadStart: "none",
                arrowheadEnd: "arrow",
              },
              meta: { source: "operational-seeder:room-connector" },
            });
            // Bind the start to the bottom-center of fromRoom and
            // the end to the top-center of toRoom. Same anchors the
            // painter uses for row-tether arrows (line 2142, 2154
            // of pipeline-event-painter.tsx).
            editor.createBindings([
              {
                fromId: connectorShapeId,
                toId: fromRoomId,
                type: "arrow",
                props: {
                  terminal: "start",
                  normalizedAnchor: { x: 0.5, y: 1 },
                  isExact: false,
                  isPrecise: true,
                },
                meta: {},
              },
              {
                fromId: connectorShapeId,
                toId: toRoomId,
                type: "arrow",
                props: {
                  terminal: "end",
                  normalizedAnchor: { x: 0.5, y: 0 },
                  isExact: false,
                  isPrecise: true,
                },
                meta: {},
              },
            ]);
            // Z-order is handled by creation sequence: rooms were
            // sendToBack'd above (deepest), connectors are created
            // after them so they layer on top of rooms but below
            // any artifact cards spawned later. No explicit
            // re-ordering needed here.
            setFlag(connectorFlagK);
          } catch (err) {
            console.warn(
              `[operational-seeder] connector ${fromStage}→${toStage} failed:`,
              err,
            );
          }
        }

        if (cancelled) return;

        // ── 0c. Layer ontology stack (left edge of KG room) ──────
        // Reads /api/spaces/[id]/layer-ontology and renders the
        // domain's layer hierarchy as a vertical stack inside the KG
        // room. The ontology already drives entity-card color badges
        // (kg-node-shape uses useLayerOntology); this surfaces the
        // FULL hierarchy so users see e.g. "this Cognitive Performance
        // space organizes entities through Exogenous → Behaviors → ...
        // → Composite" — a domain spine that was previously invisible.
        //
        // Empty-state: spawner skips (no shape) when the ontology
        // endpoint returns []. Legacy spaces / use-case templates
        // without an ontology see no stack — graceful degradation.
        //
        // Position: left edge of KG room, top-aligned. 24px from the
        // left edge so the color bars don't kiss the room border;
        // 0px from top so it sits right under the room header.
        const layerStackFlagK = flagKey("layer-stack");
        const layerStackShapeId = createShapeId(`layer-stack-${spaceId}`);
        if (!editor.getShape(layerStackShapeId) && !flag(layerStackFlagK)) {
          try {
            // D-track β — load ontology + layer-dependencies in parallel
            // so the shape spawns with both layer rows AND any
            // cross-layer cascade arrows in one paint. Dependencies are
            // an optional second-class signal: if the endpoint 404s,
            // throws, or returns [] (cascade prediction hasn't run yet
            // for this space), the shape still renders its layer rows
            // without the arrow gutter.
            const [ontologyRes, depsRes] = await Promise.all([
              fetch(
                `/api/spaces/${encodeURIComponent(spaceId)}/layer-ontology`,
              ),
              fetch(
                `/api/spaces/${encodeURIComponent(spaceId)}/layer-dependencies`,
              ).catch(() => null),
            ]);
            if (ontologyRes.ok && !cancelled) {
              const json = (await ontologyRes.json()) as {
                ontology?: Array<{
                  id: string;
                  ordinal: number;
                  slug: string;
                  label: string;
                  color: string;
                  typical_node_kinds: string[] | null;
                }>;
              };
              const layers = (json.ontology ?? [])
                .filter((l) => l && typeof l.label === "string")
                .map((l) => ({
                  id: l.id,
                  ordinal: l.ordinal,
                  slug: l.slug,
                  label: l.label,
                  color: l.color,
                  typical_node_kinds: l.typical_node_kinds ?? [],
                }));

              // Pull cascade rows in the shape that LayerStackShape's
              // ParsedDependency expects. Strip DB-managed fields (id,
              // user_id, confidence, generated_at) so the JSON stays
              // compact on the shape props.
              let dependencies: Array<{
                from_layer_id: string;
                to_layer_id: string;
                kind: string;
                strength: number;
                lag_label: string | null;
                mechanism: string;
              }> = [];
              if (depsRes && depsRes.ok) {
                try {
                  const depsJson = (await depsRes.json()) as {
                    dependencies?: Array<{
                      from_layer_id: string;
                      to_layer_id: string;
                      kind: string;
                      strength: number;
                      lag_label: string | null;
                      mechanism: string;
                    }>;
                  };
                  dependencies = (depsJson.dependencies ?? []).map((d) => ({
                    from_layer_id: d.from_layer_id,
                    to_layer_id: d.to_layer_id,
                    kind: d.kind,
                    strength: d.strength,
                    lag_label: d.lag_label,
                    mechanism: d.mechanism,
                  }));
                } catch {
                  /* non-fatal — bad JSON from deps endpoint just means
                     no arrow gutter. The shape renders cleanly. */
                }
              }

              if (layers.length > 0) {
                // Width: 180 base, +60 gutter when cascade arrows are
                // present (shape internally suppresses the gutter when
                // dependenciesJson is empty so visible width matches).
                // Height enough for ~75px per row + header. Cap at 600
                // (the KG room body is ~600 tall after accounting for
                // ROOM_PADDING).
                const hasDeps = dependencies.length > 0;
                const STACK_W = hasDeps ? 240 : 180;
                const STACK_H = Math.min(
                  600,
                  Math.max(160, layers.length * 78 + 40),
                );
                // Anchor at left edge of KG room. ROOM_W is 1900;
                // placeCenteredInsideRoom expects an offset from
                // center, so left edge with 24px padding =
                // -ROOM_W/2 + 24 + STACK_W/2 from center.
                const ROOM_W = 1900;
                const offsetX = -ROOM_W / 2 + 24 + STACK_W / 2;
                const stackPos = placeCenteredInsideRoom(
                  "kg",
                  SEED_ANCHOR,
                  STACK_W,
                  STACK_H,
                  offsetX,
                  0,
                );
                editor.markHistoryStoppingPoint(
                  `auto-place-layer-stack-${spaceId}`,
                );
                editor.createShape<LayerStackShape>({
                  id: layerStackShapeId,
                  type: "layer-stack",
                  x: stackPos.x,
                  y: stackPos.y,
                  props: {
                    w: STACK_W,
                    h: STACK_H,
                    spaceId,
                    layersJson: JSON.stringify(layers),
                    dependenciesJson: JSON.stringify(dependencies),
                  },
                  meta: { source: "operational-seeder:layer-stack" },
                });
                setFlag(layerStackFlagK);
              }
            }
          } catch {
            /* non-fatal — layer ontology may not exist (use-case templates,
               legacy spaces) — graceful degrade to no shape */
          }
        }

        if (cancelled) return;

        // ── 1. Strategy hero card ──────────────────────────────
        const heroFlagK = flagKey("strategy-hero");
        const heroShapeId = createShapeId(`strategy-hero-${spaceId}`);
        if (!editor.getShape(heroShapeId) && !flag(heroFlagK)) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/twin-proposal`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                ranked_strategies?: Array<{
                  rank: number;
                  title: string;
                  summary: string;
                  confidence: number | null;
                  posture: string;
                  // E3 — present on stratified variants, null on
                  // comprehensive variants. Source: the GET endpoint's
                  // RankedStrategyEntry flattening.
                  layer_focus: {
                    layer_id: string;
                    label: string;
                    color: string;
                  } | null;
                }>;
              };
              const ranked = json.ranked_strategies ?? [];
              const top = ranked[0];
              if (top && !cancelled) {
                // Anchor inside the proposal room — the canonical
                // home for ranked strategies. 24px down from the
                // header so the card breathes; centered horizontally.
                const heroPos = placeCenteredInsideRoom(
                  "proposal",
                  SEED_ANCHOR,
                  STRATEGY_HERO_DEFAULT_W,
                  STRATEGY_HERO_DEFAULT_H,
                  0,
                  24,
                );
                editor.markHistoryStoppingPoint(`auto-place-strategy-hero-${spaceId}`);
                editor.createShape<StrategyHeroCardShape>({
                  id: heroShapeId,
                  type: "strategy-hero-card",
                  x: heroPos.x,
                  y: heroPos.y,
                  props: {
                    w: STRATEGY_HERO_DEFAULT_W,
                    h: STRATEGY_HERO_DEFAULT_H,
                    spaceId,
                    totalRanks: ranked.length,
                    activeRank: top.rank ?? 1,
                    activeTitle: top.title,
                    activeSummary: top.summary,
                    activeConfidence: top.confidence,
                    activePosture: top.posture,
                    pulse: 0,
                    // E3 — thread the flattened layer_focus into the
                    // three shape props. When null (comprehensive
                    // variant), all three stay null and the chip +
                    // left-edge stripe stay hidden.
                    activeLayerFocusId: top.layer_focus?.layer_id ?? null,
                    activeLayerFocusLabel: top.layer_focus?.label ?? null,
                    activeLayerFocusColor: top.layer_focus?.color ?? null,
                  },
                  meta: { source: "operational-seeder:strategy-hero" },
                });
                setFlag(heroFlagK);
              }
            }
          } catch {
            /* non-fatal — strategy may not exist yet for this space */
          }
        } else if (editor.getShape(heroShapeId)) {
          // Shape already on canvas; mark the flag so we don't try again.
          setFlag(heroFlagK);
        }

        if (cancelled) return;

        // ── 1b. Hypothesis ladder cards inside Proposal room ─────
        // One card per row in `hypothesis_ladders` (extracted from
        // pre_mortem on twin-proposal approval). Anchored as a
        // horizontal strip BELOW the strategy-hero so users see
        // "this is the strategy → these are its falsifiable claims"
        // as a vertical reading order. Cap at 4 visible (typical
        // pre_mortem produces 3-5 entries).
        //
        // Falsification rigor closes the gap variable_proposals
        // didn't fill: variables are the metrics; ladders are the
        // claims those metrics test.
        const hypoFlagK = flagKey("hypothesis-ladders");
        if (!flag(hypoFlagK)) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/hypothesis-ladders`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                ladders?: Array<{
                  id: string;
                  claim: string;
                  mechanism_chain: unknown;
                  falsifier: string | null;
                  verdict:
                    | "pending"
                    | "supported"
                    | "refuted"
                    | "contested";
                  source_category:
                    | "internal"
                    | "structural"
                    | "competitive"
                    | "timing"
                    | "interaction"
                    | null;
                  severity:
                    | "catastrophic"
                    | "major"
                    | "moderate"
                    | null;
                  probability: "high" | "moderate" | "low" | null;
                }>;
              };
              const ladders = (json.ladders ?? []).slice(0, 4);
              if (ladders.length > 0 && !cancelled) {
                const HYPO_W = 320;
                const HYPO_H = 360;
                const HYPO_GAP = 16;
                const totalRowW =
                  ladders.length * HYPO_W +
                  (ladders.length - 1) * HYPO_GAP;
                // Center the row horizontally inside the proposal
                // room, anchored 420px below the room header — past
                // the strategy-hero card (which sits at offset
                // ~24-260 inside the room) so the ladders read
                // "below the strategy" as their semantic context.
                const rowCenter = placeCenteredInsideRoom(
                  "proposal",
                  SEED_ANCHOR,
                  totalRowW,
                  HYPO_H,
                  0,
                  420,
                );
                editor.markHistoryStoppingPoint(
                  `auto-place-hypothesis-ladders-${spaceId}`,
                );
                const shapesToCreate = ladders
                  .map((l, i) => {
                    const id = createShapeId(
                      `hypothesis-ladder-${spaceId}-${l.id}`,
                    );
                    if (editor.getShape(id)) return null;
                    // Re-stringify the mechanism chain for the
                    // shape's prop. The DB returns a JSON-decoded
                    // array; the shape stores it as a string and
                    // safeParseChain() in the view re-parses on
                    // render — same JSON-string-prop pattern as
                    // probability-space-shell's entitiesJson.
                    const mechanismChainJson = JSON.stringify(
                      Array.isArray(l.mechanism_chain)
                        ? l.mechanism_chain
                        : [],
                    );
                    return {
                      id,
                      type: "hypothesis-ladder" as const,
                      x: rowCenter.x + i * (HYPO_W + HYPO_GAP),
                      y: rowCenter.y,
                      props: {
                        w: HYPO_W,
                        h: HYPO_H,
                        ladderId: l.id,
                        claim: l.claim,
                        mechanismChainJson,
                        falsifier: l.falsifier,
                        verdict: l.verdict,
                        category: l.source_category,
                        severity: l.severity,
                        probability: l.probability,
                      },
                      meta: {
                        source: "operational-seeder:hypothesis-ladder",
                      },
                    };
                  })
                  .filter((s): s is NonNullable<typeof s> => s !== null);
                if (shapesToCreate.length > 0) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  editor.createShapes(shapesToCreate as any[]);
                }
                setFlag(hypoFlagK);
              }
            }
          } catch {
            /* non-fatal — pre_mortem may not have produced ladders yet */
          }
        }

        if (cancelled) return;

        // ── 2. Twin snapshot ───────────────────────────────────
        const twinFlagK = flagKey("twin-snapshot");
        const twinShapeId = createShapeId(`twin-snapshot-${spaceId}`);
        if (!editor.getShape(twinShapeId) && !flag(twinFlagK)) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/twin-state`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                twin?: TwinMacroState;
                computed_at?: string;
                space_name?: string;
              };
              const macro = json.twin;
              // Only spawn when the twin is meaningful — i.e. the space
              // has been processed enough to have at least a few entities.
              // Sub-3 means it's a brand-new shell with nothing to show
              // and the snapshot card would render misleading zeros.
              if (
                macro &&
                macro.coverage.entities_modeled >= 3 &&
                !cancelled
              ) {
                // Anchor inside the twin room — the digital-twin
                // band of the cascade. Centered horizontally; 24px
                // down from header.
                const twinPos = placeCenteredInsideRoom(
                  "twin",
                  SEED_ANCHOR,
                  TWIN_SNAP_W,
                  TWIN_SNAP_H,
                  0,
                  24,
                );
                editor.markHistoryStoppingPoint(`auto-place-twin-snapshot-${spaceId}`);
                editor.createShape<TwinSnapshotShape>({
                  id: twinShapeId,
                  type: "twin-snapshot",
                  x: twinPos.x,
                  y: twinPos.y,
                  props: {
                    w: TWIN_SNAP_W,
                    h: TWIN_SNAP_H,
                    spaceId,
                    spaceName: json.space_name ?? spaceName,
                    snappedAt: json.computed_at ?? new Date().toISOString(),
                    healthScore: Math.round(macro.health_score ?? 0),
                    healthLabel: macro.health_label,
                    maturity: macro.maturity,
                    entitiesCount: macro.coverage.entities_modeled,
                    edgesCount: macro.coverage.edges_mapped,
                    cyclesCount: macro.coverage.cycles_detected,
                    leveragePoints: macro.dynamics.leverage_points,
                    riskPoints: macro.risk_exposure.total_risk_points,
                    reinforcingPositive: macro.dynamics.reinforcing_positive,
                    reinforcingNegative: macro.dynamics.reinforcing_negative,
                    balancing: macro.dynamics.balancing,
                    bottleneckName: macro.risk_exposure.bottleneck_name,
                    bottleneckShare:
                      macro.risk_exposure.bottleneck_system_share != null
                        ? macro.risk_exposure.bottleneck_system_share / 100
                        : null,
                  },
                });
                setFlag(twinFlagK);
              }
            }
          } catch {
            /* non-fatal — twin state may not be computable yet */
          }
        } else if (editor.getShape(twinShapeId)) {
          setFlag(twinFlagK);
        }

        if (cancelled) return;

        // ── 2b. Mechanism cards inside Twin room ────────────────
        // Read the mechanism rows for this space and spawn one
        // mechanism-card shape per row, anchored inside the twin room
        // to the right of the twin-snapshot. Mechanisms are first-
        // class in the DB (migration 20260509) but were invisible on
        // the canvas before this — apps were rendered, but the
        // mechanism layer that connects strategy proposals → apps
        // was a hidden supernode. This surfaces the cycle pattern,
        // status, agent count, and app count per mechanism so the
        // user can see "this twin runs 3 mechanisms" instead of
        // having to open a dashboard to discover that.
        //
        // Layout: horizontal strip starting just right of where the
        // twin-snapshot lands. Cap at 5 cards visible (per audit:
        // typical count is 1-5); overflow note is a future ticket.
        const mechFlagK = flagKey("mechanism-cards");
        if (!flag(mechFlagK)) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/mechanisms`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                mechanisms?: Array<{
                  id: string;
                  name: string;
                  kind: string;
                  cycle_pattern: string | null;
                  rationale: string | null;
                  status: string;
                  agent_assignments: unknown;
                  app_count: number;
                }>;
              };
              const mechs = (json.mechanisms ?? []).slice(0, 5);
              if (mechs.length > 0 && !cancelled) {
                // Lay cards out left-to-right, starting to the right
                // of the twin-snapshot (which is centered in the
                // room). Each card is MECH_W wide with a small gap.
                const MECH_W = 240;
                const MECH_H = 160;
                const MECH_GAP = 16;
                const totalRowW =
                  mechs.length * MECH_W + (mechs.length - 1) * MECH_GAP;
                // Position the row's center 320px right of the twin
                // room's center so the snapshot sits flush-left of
                // the row. 24px down to align vertically with the
                // snapshot card.
                const rowCenter = placeCenteredInsideRoom(
                  "twin",
                  SEED_ANCHOR,
                  totalRowW,
                  MECH_H,
                  320,
                  24,
                );
                editor.markHistoryStoppingPoint(
                  `auto-place-mechanism-cards-${spaceId}`,
                );
                const validKinds = new Set([
                  "simulation",
                  "prediction",
                  "validation",
                  "baseline_tracking",
                  "deviation_capture",
                  "game",
                  "ml_personalization",
                ]);
                const validStatuses = new Set([
                  "proposed",
                  "approved",
                  "active",
                  "paused",
                  "retired",
                ]);
                const shapesToCreate = mechs
                  .map((m, i) => {
                    const id = createShapeId(`mechanism-${spaceId}-${m.id}`);
                    if (editor.getShape(id)) return null;
                    // Defensive narrowing — the API returns kind/status
                    // as bare strings even though the DB has CHECK
                    // constraints. Skip rows whose values don't fit
                    // our shape's literal-enum props.
                    if (!validKinds.has(m.kind)) return null;
                    if (!validStatuses.has(m.status)) return null;
                    const agentCount = Array.isArray(m.agent_assignments)
                      ? m.agent_assignments.length
                      : 0;
                    return {
                      id,
                      type: "mechanism-card" as const,
                      x: rowCenter.x + i * (MECH_W + MECH_GAP),
                      y: rowCenter.y,
                      props: {
                        w: MECH_W,
                        h: MECH_H,
                        mechanismId: m.id,
                        kind: m.kind as
                          | "simulation"
                          | "prediction"
                          | "validation"
                          | "baseline_tracking"
                          | "deviation_capture"
                          | "game"
                          | "ml_personalization",
                        name: m.name,
                        cyclePattern: m.cycle_pattern ?? null,
                        rationale: m.rationale ?? null,
                        status: m.status as
                          | "proposed"
                          | "approved"
                          | "active"
                          | "paused"
                          | "retired",
                        agentCount,
                        appCount: m.app_count ?? 0,
                      },
                      meta: { source: "operational-seeder:mechanism-card" },
                    };
                  })
                  .filter((s): s is NonNullable<typeof s> => s !== null);
                if (shapesToCreate.length > 0) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  editor.createShapes(shapesToCreate as any[]);
                }
                setFlag(mechFlagK);
              }
            }
          } catch {
            /* non-fatal — no mechanisms is a valid state pre-strategy-approval */
          }
        }

        if (cancelled) return;

        // ── 2bb. Learning-loop card inside Twin room ────────────
        // P1.1: the strategy's StrategyLearningLoop rendered as a
        // canvas shape. Today the same data is rendered only inside
        // the off-canvas strategy-page's whiteboard-view
        // (build-whiteboard-model.ts:422-459); this brings it onto
        // the actual tldraw canvas where the user lives.
        //
        // Position: centered below the mechanism row, above the
        // trajectory fan row. Twin room reads top→bottom as:
        //   • twin-snapshot (state) + mechanism cards (substrate)
        //   • learning-loop card (dashboard — what to watch + pivot)
        //   • trajectory fans (forecast)
        //
        // Data source: twin-proposal GET response carries
        // `learning_loop` (extracted from synthesis_data.
        // strategic_recommendation by the route handler). Singleton
        // per space — deterministic shape id; localStorage flag so a
        // user-dismissal sticks.
        const learningFlagK = flagKey("learning-loop");
        const learningShapeId = createShapeId(
          `learning-loop-${spaceId}`,
        );
        if (!editor.getShape(learningShapeId) && !flag(learningFlagK)) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/twin-proposal`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                learning_loop?: {
                  lagging_indicator?: {
                    metric?: string;
                    target?: string;
                    deadline?: string;
                  };
                  leading_indicators?: Array<{
                    metric?: string;
                    measurement_method?: string;
                    cadence?: string;
                    green_reading?: string;
                    yellow_reading?: string;
                    red_reading?: string;
                  }>;
                  review_cadence?: {
                    metric_checks?: string;
                    full_strategy_review?: string;
                    total_cycles_in_timeline?: number;
                  };
                  pivot_criteria?: Array<{
                    signal?: string;
                    response?: string;
                    specific_action?: string;
                    timeline?: string;
                  }>;
                  persistence_signals?: Array<unknown>;
                } | null;
              };
              const ll = json.learning_loop ?? null;
              // Spawn only when there's something meaningful to show:
              // either a lagging indicator OR at least one leading
              // indicator. Without either the card is a bag of
              // placeholders that says "no signal here" — worse than
              // not spawning.
              const hasLagging =
                typeof ll?.lagging_indicator?.metric === "string" &&
                ll.lagging_indicator.metric.trim().length > 0;
              const hasLeading =
                Array.isArray(ll?.leading_indicators) &&
                ll!.leading_indicators!.length > 0;
              if (ll && (hasLagging || hasLeading) && !cancelled) {
                // Layout: anchor below the mechanism-card row (which
                // started ~70px below twin-snapshot, occupies ~190px
                // tall). Pad ~110px from the room header to clear
                // both. Centered horizontally inside the twin room.
                const learningPos = placeCenteredInsideRoom(
                  "twin",
                  SEED_ANCHOR,
                  LEARNING_LOOP_DEFAULT_W,
                  LEARNING_LOOP_DEFAULT_H,
                  0,
                  TWIN_SNAP_H + 80, // 80px gap below twin-snapshot row
                );

                // Normalize the indicator + pivot arrays for the
                // shape's JSON props. We drop entries without a
                // metric since the shape can't render them
                // meaningfully.
                const leadingClean = (ll.leading_indicators ?? [])
                  .filter(
                    (li) =>
                      typeof li?.metric === "string" &&
                      li.metric.trim().length > 0,
                  )
                  .slice(0, 4)
                  .map((li) => ({
                    metric: li.metric,
                    cadence: li.cadence ?? "",
                    green_reading: li.green_reading ?? "",
                    yellow_reading: li.yellow_reading ?? "",
                    red_reading: li.red_reading ?? "",
                    measurement_method: li.measurement_method ?? "",
                    status: "unknown" as const,
                  }));
                const pivotsClean = (ll.pivot_criteria ?? [])
                  .filter(
                    (p) =>
                      typeof p?.signal === "string" &&
                      p.signal.trim().length > 0,
                  )
                  .map((p) => ({
                    signal: p.signal,
                    response: p.response ?? "",
                    specific_action: p.specific_action ?? "",
                    timeline: p.timeline ?? "",
                  }));

                editor.markHistoryStoppingPoint(
                  `auto-place-learning-loop-${spaceId}`,
                );
                editor.createShape<LearningLoopCardShape>({
                  id: learningShapeId,
                  type: "learning-loop-card",
                  x: learningPos.x,
                  y: learningPos.y,
                  props: {
                    w: LEARNING_LOOP_DEFAULT_W,
                    h: LEARNING_LOOP_DEFAULT_H,
                    spaceId,
                    capturedAt: new Date().toISOString(),
                    laggingMetric: ll.lagging_indicator?.metric ?? "",
                    laggingTarget: ll.lagging_indicator?.target ?? "",
                    laggingDeadline:
                      ll.lagging_indicator?.deadline ?? "",
                    leadingIndicatorsJson: JSON.stringify(leadingClean),
                    metricCheckCadence:
                      ll.review_cadence?.metric_checks ?? "",
                    reviewCadence:
                      ll.review_cadence?.full_strategy_review ?? "",
                    totalCycles:
                      typeof ll.review_cadence
                        ?.total_cycles_in_timeline === "number"
                        ? ll.review_cadence!.total_cycles_in_timeline
                        : 0,
                    pivotCriteriaJson: JSON.stringify(pivotsClean),
                    persistenceCount: Array.isArray(
                      ll.persistence_signals,
                    )
                      ? ll.persistence_signals.length
                      : 0,
                    accent: "#7C3AED",
                  },
                });
                setFlag(learningFlagK);
              }
            }
          } catch {
            /* non-fatal — no learning_loop is a valid state pre-strategy */
          }
        } else if (editor.getShape(learningShapeId)) {
          setFlag(learningFlagK);
        }

        if (cancelled) return;

        // ── 2c. Trajectory fan cards inside Twin room ────────────
        // Read prediction_ledger trajectory rows and spawn a fan-chart
        // card per row. Anchored as a horizontal strip BELOW the
        // mechanism-card row so the twin room reads top→bottom as:
        //   • twin-snapshot (state) + mechanism cards (substrate)
        //   • trajectory fans (forecast)
        // This surfaces "what the simulator predicts" at the same
        // density as the rest of the twin-room content, instead of
        // requiring a separate TrajectoryPanel side-page navigation.
        //
        // Cap at 3 — typical spaces have 1-3 trajectories pinned;
        // overflow is queryable via the dedicated detail page.
        const trajFlagK = flagKey("trajectory-fans");
        if (!flag(trajFlagK)) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/trajectories?limit=3`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                trajectories?: Array<{
                  id: string;
                  metric_label: string;
                  metric_unit: string | null;
                  horizon_at: string | null;
                  predicted_at: string;
                  confidence: number | null;
                  predicted_distribution: unknown;
                  predicted_trajectory: unknown;
                }>;
              };
              const trajs = (json.trajectories ?? []).slice(0, 3);
              if (trajs.length > 0 && !cancelled) {
                const TRAJ_W = 320;
                const TRAJ_H = 200;
                const TRAJ_GAP = 16;
                const totalRowW =
                  trajs.length * TRAJ_W + (trajs.length - 1) * TRAJ_GAP;
                // Position 220px BELOW the mechanism-card row's center
                // (mechanism row sat at offsetY=24; this row sits below
                // at offsetY=244 inside the twin room). Horizontally
                // centered like the mechanism row was at offsetX=320.
                const rowCenter = placeCenteredInsideRoom(
                  "twin",
                  SEED_ANCHOR,
                  totalRowW,
                  TRAJ_H,
                  320,
                  244,
                );
                editor.markHistoryStoppingPoint(
                  `auto-place-trajectory-fans-${spaceId}`,
                );
                const shapesToCreate = trajs
                  .map((t, i) => {
                    const id = createShapeId(
                      `trajectory-fan-${spaceId}-${t.id}`,
                    );
                    if (editor.getShape(id)) return null;
                    // Re-stringify trajectory + final distribution as
                    // shape props since tldraw can't carry arrays/objects
                    // directly. Same JSON-string pattern probability-
                    // space-shell uses for entitiesJson.
                    const trajectoryJson = JSON.stringify(
                      Array.isArray(t.predicted_trajectory)
                        ? t.predicted_trajectory
                        : [],
                    );
                    const finalDistributionJson =
                      t.predicted_distribution &&
                      typeof t.predicted_distribution === "object"
                        ? JSON.stringify(t.predicted_distribution)
                        : "";
                    return {
                      id,
                      type: "trajectory-fan" as const,
                      x: rowCenter.x + i * (TRAJ_W + TRAJ_GAP),
                      y: rowCenter.y,
                      props: {
                        w: TRAJ_W,
                        h: TRAJ_H,
                        predictionId: t.id,
                        metricLabel: t.metric_label,
                        metricUnit: t.metric_unit,
                        horizonAt: t.horizon_at,
                        predictedAt: t.predicted_at,
                        confidence: t.confidence,
                        trajectoryJson,
                        finalDistributionJson,
                      },
                      meta: {
                        source: "operational-seeder:trajectory-fan",
                      },
                    };
                  })
                  .filter((s): s is NonNullable<typeof s> => s !== null);
                if (shapesToCreate.length > 0) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  editor.createShapes(shapesToCreate as any[]);
                }
                setFlag(trajFlagK);
              }
            }
          } catch {
            /* non-fatal — no trajectories is a valid pre-prediction state */
          }
        }

        if (cancelled) return;

        // ── 3. Synthesis cards (bottleneck + leverage + risk) ─────
        // The AMBIENT side-panel's content as draggable canvas cards.
        // Spawned together as a row so the visual narrative reads
        // bottleneck → leverage points → risk points.
        const synthFlagK = flagKey("synthesis-cards");
        if (!flag(synthFlagK)) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/synthesis-insights`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                bottleneck: {
                  entity_id: string;
                  name: string;
                  body: string;
                } | null;
                leverage_points: Array<{
                  entity_id: string;
                  name: string;
                  body: string;
                }>;
                risk_points: Array<{
                  entity_id: string;
                  name: string;
                  body: string;
                }>;
              };

              // Build a deterministic spawn list. Order matters for
              // left-to-right narrative + matches the eventual room
              // anchoring (all live in the synthesize room).
              type SynthSpawn = {
                kind: "leverage" | "risk";
                title: string;
                body: string;
                sourceEntityIds: string[];
                stableSlug: string;
              };
              const queue: SynthSpawn[] = [];

              if (json.bottleneck) {
                // Bottleneck renders as kind="risk" — it's the master
                // constraint, the highest-blast-radius risk_point. The
                // synthesis-card shape doesn't have a dedicated
                // bottleneck kind; risk is the right semantic match.
                queue.push({
                  kind: "risk",
                  title: `Bottleneck: ${json.bottleneck.name}`,
                  body: json.bottleneck.body,
                  sourceEntityIds: json.bottleneck.entity_id
                    ? [json.bottleneck.entity_id]
                    : [],
                  stableSlug: "bottleneck",
                });
              }

              for (const lp of json.leverage_points.slice(
                0,
                SYNTH_MAX_LEVERAGE,
              )) {
                queue.push({
                  kind: "leverage",
                  title: lp.name,
                  body: lp.body,
                  sourceEntityIds: lp.entity_id ? [lp.entity_id] : [],
                  stableSlug: `leverage-${lp.entity_id || queue.length}`,
                });
              }

              for (const rp of json.risk_points.slice(0, SYNTH_MAX_RISK)) {
                queue.push({
                  kind: "risk",
                  title: rp.name,
                  body: rp.body,
                  sourceEntityIds: rp.entity_id ? [rp.entity_id] : [],
                  stableSlug: `risk-${rp.entity_id || queue.length}`,
                });
              }

              if (queue.length > 0 && !cancelled) {
                // Synthesis cards (bottleneck/leverage/risk) live
                // in the kg room — they're insights derived from
                // the knowledge graph. Layout: horizontal row,
                // centered, anchored 280px down from the room
                // header so the kg-formation/kg-overview content
                // (when present) sits above them rather than
                // overlapping.
                const totalW =
                  queue.length * SYNTH_CARD_W +
                  (queue.length - 1) * SYNTH_GAP;
                const rowCenter = placeCenteredInsideRoom(
                  "kg",
                  SEED_ANCHOR,
                  totalW,
                  SYNTH_CARD_H,
                  0,
                  280,
                );

                editor.markHistoryStoppingPoint(
                  `auto-place-synthesis-cards-${spaceId}`,
                );
                const shapesToCreate = queue
                  .map((entry, i) => {
                    const id = createShapeId(
                      `synthesis-${spaceId}-${entry.stableSlug}`,
                    );
                    // Skip if already present from a prior seed pass or
                    // a live painter hit.
                    if (editor.getShape(id)) return null;
                    return {
                      id,
                      type: "synthesis-card" as const,
                      x: rowCenter.x + i * (SYNTH_CARD_W + SYNTH_GAP),
                      y: rowCenter.y,
                      props: {
                        w: SYNTH_CARD_W,
                        h: SYNTH_CARD_H,
                        kind: entry.kind,
                        title: entry.title,
                        body: entry.body,
                        sourceEntityIds: entry.sourceEntityIds,
                      },
                      meta: {
                        source: "operational-seeder:synthesis-card",
                      },
                    };
                  })
                  .filter(
                    (s): s is NonNullable<typeof s> => s !== null,
                  ) as Array<Partial<SynthesisCardShape> & { type: "synthesis-card" }>;

                if (shapesToCreate.length > 0) {
                  editor.createShapes(shapesToCreate);
                }
                setFlag(synthFlagK);
              }
            }
          } catch {
            /* non-fatal — synthesis_data may not be populated yet */
          }
        }

        if (cancelled) return;

        // ── 3b. Cycle-loop cards inside KG room ────────────────────
        // L1.1: auto-spawn one cycle-loop card per detected feedback
        // loop. Today these only manifest as the convergence ring on
        // member entities — the loop itself only appears if the user
        // manually drags from the library. This block fetches the
        // cycles table and spawns a card for each, so already-completed
        // spaces (where no SSE fires) also get the loops visible.
        //
        // Deterministic shape ID `cycle-loop-${cycleId}` matches the
        // live painter (paintCycle), so whichever fires first wins and
        // the other becomes a no-op — no duplicates across the
        // canvas-mount vs during-run paths.
        //
        // Layout: 4 per row, ~480px below the kg-room content top.
        // Same as the painter so re-paints from a fresh run align with
        // any cards seeded earlier.
        const cyclesFlagK = flagKey("cycle-loops");
        if (!flag(cyclesFlagK)) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/cycles`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                cycles?: Array<{
                  id: string;
                  cycle_id: string;
                  name: string | null;
                  classification: string;
                  entity_ids: string[];
                  estimated_multiplier: number | null;
                }>;
                entity_name_by_id?: Record<string, string>;
              };
              const cyclesList = json.cycles ?? [];
              const nameLookup = json.entity_name_by_id ?? {};
              if (cyclesList.length > 0 && !cancelled) {
                const PER_ROW = 4;
                const CARD_W = 260;
                const CARD_H = 140;
                const GAP_X = 16;
                const GAP_Y = 16;
                const placement = placeInsideRoom(
                  "kg",
                  SEED_ANCHOR,
                  0,
                  480,
                );
                const totalRowWidth =
                  PER_ROW * CARD_W + (PER_ROW - 1) * GAP_X;
                const rowStartX = placement.x - totalRowWidth / 2;

                const VALID_CLASSIFICATIONS = [
                  "reinforcing_positive",
                  "reinforcing_negative",
                  "balancing",
                ] as const;
                type ValidClassification = (typeof VALID_CLASSIFICATIONS)[number];

                const shapesToCreate: Array<Partial<CycleLoopShape> & {
                  type: "cycle-loop";
                }> = [];

                cyclesList.forEach((c, idx) => {
                  const shapeId = createShapeId(`cycle-loop-${c.cycle_id}`);
                  // Idempotent: if the painter (or a prior seed pass)
                  // already created this shape, leave it alone.
                  if (editor.getShape(shapeId)) return;

                  const col = idx % PER_ROW;
                  const row = Math.floor(idx / PER_ROW);
                  const x = Math.round(rowStartX + col * (CARD_W + GAP_X));
                  const y = Math.round(placement.y + row * (CARD_H + GAP_Y));

                  // Resolve up to 4 entity names from the lookup map.
                  // Members without resolved names just don't contribute
                  // to the preview — card falls back to nodeCount.
                  const entityIds = Array.isArray(c.entity_ids)
                    ? c.entity_ids
                    : [];
                  const entityNames: string[] = [];
                  for (const eid of entityIds.slice(0, 4)) {
                    const nm = nameLookup[eid];
                    if (nm && nm.length > 0) entityNames.push(nm);
                  }

                  // Normalize classification to the enum the shape accepts.
                  const classification: ValidClassification =
                    (VALID_CLASSIFICATIONS as readonly string[]).includes(
                      c.classification,
                    )
                      ? (c.classification as ValidClassification)
                      : "balancing";

                  shapesToCreate.push({
                    id: shapeId,
                    type: "cycle-loop",
                    x,
                    y,
                    props: {
                      w: CARD_W,
                      h: CARD_H,
                      cycleId: c.cycle_id,
                      spaceId,
                      name: c.name && c.name.length > 0 ? c.name : "Untitled cycle",
                      classification,
                      entityNames,
                      nodeCount: entityIds.length,
                      multiplier: c.estimated_multiplier ?? null,
                      firstEntityId: entityIds[0] ?? null,
                    },
                  });
                });

                if (shapesToCreate.length > 0) {
                  editor.markHistoryStoppingPoint(
                    `auto-place-cycle-loops-${spaceId}`,
                  );
                  editor.createShapes(shapesToCreate);
                }
                setFlag(cyclesFlagK);
              }
            }
          } catch {
            /* non-fatal — cycles may not be populated yet */
          }
        }

        if (cancelled) return;

        // ── 4. Forest plot card (top evidence-registries findings) ───
        // Singleton card inside the kg room visualizing the strongest
        // |effect_size| findings with CIs, ranked vertically. Anchored
        // BELOW the synthesis insights row so the visual reading order
        // is: bottleneck/leverage/risk (qualitative) → forest plot
        // (quantitative meta-analysis). One card per space — the card
        // body itself contains 8+ findings, so multiple instances would
        // be redundant. Skipped silently when no rows have effect_size +
        // both CI bounds (most spaces don't have evidence registries
        // until research runs land).
        const forestFlagK = flagKey("forest-plot");
        const forestShapeId = createShapeId(`forest-plot-${spaceId}`);
        if (
          !flag(forestFlagK) &&
          !editor.getShape(forestShapeId)
        ) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/forest-plot?limit=8`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                findings?: unknown[];
                primary_metric?: string | null;
                tier_mode?: "anchored" | "all";
                tier_counts?: Record<string, number>;
              };
              const findings = Array.isArray(json.findings)
                ? json.findings
                : [];
              const tierMode: "anchored" | "all" =
                json.tier_mode === "all" ? "all" : "anchored";
              const tierCounts =
                json.tier_counts && typeof json.tier_counts === "object"
                  ? json.tier_counts
                  : {};
              // Phase 0 rigor: when no anchored rows are present, the
              // default `anchored` filter would render the card empty.
              // Refetch with `tier=all` so the card surfaces something
              // (drifted rows are visually de-emphasized — see shape).
              // This is the only time we silently flip to permissive
              // mode on first load; the user can still toggle back.
              if (findings.length === 0 && tierMode === "anchored") {
                const driftedTotal =
                  (Number(tierCounts.web_deep_research) || 0) +
                  (Number(tierCounts.web_heuristic) || 0) +
                  (Number(tierCounts.legacy_unsourced) || 0);
                if (driftedTotal > 0) {
                  const fallback = await fetch(
                    `/api/spaces/${encodeURIComponent(spaceId)}/forest-plot?limit=8&tier=all`,
                  );
                  if (fallback.ok && !cancelled) {
                    const fjson = (await fallback.json()) as {
                      findings?: unknown[];
                      primary_metric?: string | null;
                      tier_mode?: "anchored" | "all";
                      tier_counts?: Record<string, number>;
                    };
                    const ffindings = Array.isArray(fjson.findings)
                      ? fjson.findings
                      : [];
                    if (ffindings.length > 0 && !cancelled) {
                      const FOREST_W = 360;
                      const FOREST_H = 320;
                      const pos = placeCenteredInsideRoom(
                        "kg",
                        SEED_ANCHOR,
                        FOREST_W,
                        FOREST_H,
                        0,
                        460,
                      );
                      editor.markHistoryStoppingPoint(
                        `auto-place-forest-plot-${spaceId}`,
                      );
                      editor.createShape({
                        id: forestShapeId,
                        type: "forest-plot",
                        x: pos.x,
                        y: pos.y,
                        props: {
                          w: FOREST_W,
                          h: FOREST_H,
                          findingsJson: JSON.stringify(ffindings),
                          referenceMetric: fjson.primary_metric ?? null,
                          findingCount: ffindings.length,
                          tierMode: "all",
                          tierCountsJson: JSON.stringify(
                            fjson.tier_counts ?? tierCounts,
                          ),
                        },
                        meta: { source: "operational-seeder:forest-plot" },
                      });
                      setFlag(forestFlagK);
                    }
                  }
                }
              } else if (findings.length > 0 && !cancelled) {
                const FOREST_W = 360;
                const FOREST_H = 320;
                // Anchor inside the kg room. Synthesis cards row sits
                // at offsetY=280; place the forest plot at offsetY=460
                // so it sits below the synthesis row with a small gap.
                // Centered horizontally inside the room.
                const pos = placeCenteredInsideRoom(
                  "kg",
                  SEED_ANCHOR,
                  FOREST_W,
                  FOREST_H,
                  0,
                  460,
                );
                editor.markHistoryStoppingPoint(
                  `auto-place-forest-plot-${spaceId}`,
                );
                editor.createShape({
                  id: forestShapeId,
                  type: "forest-plot",
                  x: pos.x,
                  y: pos.y,
                  props: {
                    w: FOREST_W,
                    h: FOREST_H,
                    findingsJson: JSON.stringify(findings),
                    referenceMetric: json.primary_metric ?? null,
                    findingCount: findings.length,
                    tierMode,
                    tierCountsJson: JSON.stringify(tierCounts),
                  },
                  meta: { source: "operational-seeder:forest-plot" },
                });
                setFlag(forestFlagK);
              }
            }
          } catch {
            /* non-fatal — pre-evidence-registry spaces have no findings */
          }
        }

        if (cancelled) return;

        // ── 5. Edge drift heatmap (reflexive room) ──────────────
        // Singleton card showing `edge_calibrations` aggregated by
        // edge × week as a heatmap. Anchored inside the reflexive
        // room — the audit room of the operational cascade. Skipped
        // silently when the space has no calibrations yet (most
        // spaces, until they've run prediction-resolution cycles).
        const driftFlagK = flagKey("edge-drift");
        const driftShapeId = createShapeId(`edge-drift-${spaceId}`);
        if (!flag(driftFlagK) && !editor.getShape(driftShapeId)) {
          try {
            const res = await fetch(
              `/api/spaces/${encodeURIComponent(spaceId)}/edge-drift?weeks=6&edges=8`,
            );
            if (res.ok && !cancelled) {
              const json = (await res.json()) as {
                edges?: Array<{
                  edgeId: string;
                  label: string;
                  cells: number[];
                  cumulativeAbs: number;
                  netSigned: number;
                  lastConfidenceDelta: number;
                }>;
                weekLabels?: string[];
                empty?: boolean;
              };
              const edges = Array.isArray(json.edges) ? json.edges : [];
              const weekLabels = Array.isArray(json.weekLabels)
                ? json.weekLabels
                : [];
              if (
                edges.length > 0 &&
                weekLabels.length > 0 &&
                !json.empty &&
                !cancelled
              ) {
                // Compute max |cell| across the whole matrix once so the
                // shape can color-normalize without re-walking.
                let maxAbs = 0;
                for (const e of edges) {
                  for (const c of e.cells) {
                    const ab = Math.abs(c);
                    if (ab > maxAbs) maxAbs = ab;
                  }
                }

                const DRIFT_W = 380;
                const DRIFT_H = 320;
                // Reflexive room is shorter than other rooms (h=280
                // per STAGE_HEIGHT.reflexive); anchor the card at
                // offsetY=20 so its header is visible just past the
                // room's own header.
                const pos = placeCenteredInsideRoom(
                  "reflexive",
                  SEED_ANCHOR,
                  DRIFT_W,
                  DRIFT_H,
                  0,
                  20,
                );
                editor.markHistoryStoppingPoint(
                  `auto-place-edge-drift-${spaceId}`,
                );
                editor.createShape({
                  id: driftShapeId,
                  type: "edge-drift-heatmap",
                  x: pos.x,
                  y: pos.y,
                  props: {
                    w: DRIFT_W,
                    h: DRIFT_H,
                    driftJson: JSON.stringify({ edges, weekLabels }),
                    maxAbsCell: maxAbs,
                    edgeCount: edges.length,
                    weekCount: weekLabels.length,
                  },
                  meta: { source: "operational-seeder:edge-drift" },
                });
                setFlag(driftFlagK);
              }
            }
          } catch {
            /* non-fatal — no calibrations yet is a valid state */
          }
        }
      })();
    }, POLL_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [editor, spaceId, spaceName]);

  // A5 — live room-subtitle refresh.
  //
  // The spawn effect above uses an inline /room-counts fetch for the
  // initial subtitles. This second effect handles AFTER the spawn:
  // when the useRoomCounts hook resolves (or refetches), walk every
  // room shape for this space and updateShape the subtitle when the
  // computed string differs from what's currently rendered. Cheap —
  // 8 shape lookups + (at most) 8 prop updates.
  //
  // No-op when counts haven't loaded, when no rooms exist yet, or
  // when subtitles are already up-to-date.
  useEffect(() => {
    if (!editor || !liveCounts) return;
    for (const stage of Object.keys(STAGE_ROOMS) as PipelineStage[]) {
      const roomShapeId = createShapeId(`room-${spaceId}-${stage}`);
      const shape = editor.getShape(roomShapeId);
      if (!shape) continue;
      const next = buildRoomSubtitle(stage, liveCounts);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current = (shape.props as any).subtitle;
      if (current === next) continue;
      try {
        editor.updateShape<RoomShape>({
          id: roomShapeId,
          type: "room",
          props: { subtitle: next },
        });
      } catch (err) {
        console.warn(
          `[operational-seeder] subtitle refresh failed for ${stage}:`,
          err,
        );
      }
    }
  }, [editor, spaceId, liveCounts]);

  return null;
}
