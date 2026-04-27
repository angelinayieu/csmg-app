"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Editor, TLArrowShape, TLShapeId, TLShapePartial } from "tldraw";
import { createShapeId } from "tldraw";
import type { KGNodeShape } from "../shapes/types";
import { KG_NODE_TIER_SIZE } from "../shapes/kg-node-shape";
import { entityToLayerId } from "@/lib/whiteboard/layer-config";

// Phase 8.2 — Recursive decomposition. (D5b · 2026-04-26)
//
// After a sticky materializes into a KG node, we auto-decompose into
// 2-3 proxy indicators (ghost children arc'd below). The original
// implementation hard-capped at MAX_DEPTH=2; D5b (see
// docs/KG_DEPTH_CRITIQUE.md §9) replaces that cap with a confidence-
// decay gate driven by the strategizer's existing signals
// (centrality, convergence_count, agent_convergence_count,
// causal_depth, leverage_point). The API computes
// `confidence_to_continue` server-side and returns it on the drill
// payload; the hook reads it to decide whether to schedule the next
// drill, and whether to drill any lateral siblings at the SAME depth
// before going deeper (the "broad-in-a-deep-way" pattern).
//
// Hard ceiling: ABSOLUTE_MAX_DRILL_DEPTH (6 today) regardless of
// confidence — a safety net while we accumulate telemetry on whether
// quality holds at deeper layers.

import { ABSOLUTE_MAX_DRILL_DEPTH } from "@/lib/pipeline/drill-confidence";

const IDLE_MS = 1500;
const CHILD_ARC_RADIUS = 220;

interface RecursiveChild {
  id: string;
  entity_id: string;
  name: string;
  description: string | null;
  entity_category: string | null;
  layer: string | null;
  depth: number | null;
  confidence: number | null;
}

interface RecursiveEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
}

// D5b — drill decision returned by the API. Hook treats every field
// as optional so it gracefully degrades when the API hasn't been
// upgraded yet (legacy clients keep working).
interface DrillDecision {
  parent_quality_score?: number;
  confidence_to_continue?: number;
  should_continue?: boolean;
  stop_reason?: string | null;
  absolute_max_depth?: number;
  child_depth?: number;
  lateral_sibling_ids?: string[];
}

export interface UseRecursiveDecomposeOptions {
  editor: Editor | null;
  spaceId: string;
  enabled: boolean;
  /** Entities that arrived fully-formed (e.g. from initial sync) — skip. */
  initialSkipIds?: Set<string>;
}

export function useRecursiveDecompose({
  editor,
  spaceId,
  enabled,
  initialSkipIds,
}: UseRecursiveDecomposeOptions) {
  // Depth per entity UUID. Newly-materialized entities start at 0; their
  // recursive children are depth 1; grandchildren are depth 2; etc.
  const depthByEntity = useRef(new Map<string, number>());
  // Entities we've already scheduled / fired for.
  const processed = useRef(new Set<string>());
  // Skip entities that existed before the canvas loaded.
  const skip = useRef<Set<string>>(new Set());
  // D5b — per-entity confidence-to-continue inherited from the drill
  // decision that produced this entity. Newly-materialized entities
  // (depth 0, no parent drill) implicitly have full confidence and
  // get the API's parent_quality_score back on first drill.
  const confidenceByEntity = useRef(new Map<string, number>());

  useEffect(() => {
    if (initialSkipIds) skip.current = initialSkipIds;
  }, [initialSkipIds]);

  // Core RPC: call the recursive-decompose endpoint + place children ghosts.
  const runRecursive = useCallback(
    async (parentShapeId: TLShapeId, parentEntityId: string, parentDepth: number) => {
      if (!editor) return;

      try {
        const res = await fetch("/api/canvas/recursive-decompose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, entityId: parentEntityId }),
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          children: RecursiveChild[];
          edges: RecursiveEdge[];
          drill?: DrillDecision;
        };
        if (!payload.children || payload.children.length === 0) return;

        // D5b — record confidence for each child so future drill
        // decisions can chain off it. The API has already gated the
        // continuation, so confidence_to_continue here represents
        // "if you decide to drill into one of these children, this
        // is the inherited confidence."
        const inheritedConfidence =
          typeof payload.drill?.confidence_to_continue === "number"
            ? payload.drill.confidence_to_continue
            : 0;

        const parentBounds = editor.getShapePageBounds(parentShapeId);
        if (!parentBounds) return;

        const { TIER_WIDTH, TIER_HEIGHT } = KG_NODE_TIER_SIZE;
        const tier = "support" as const;
        const w = TIER_WIDTH[tier];
        const h = TIER_HEIGHT[tier];

        // Arc positioning: children span ~120° below the parent.
        const count = payload.children.length;
        const spread = Math.min(120, 50 + count * 25); // degrees
        const startAngle = 90 - spread / 2; // 90° = straight down
        const step = count > 1 ? spread / (count - 1) : 0;

        editor.markHistoryStoppingPoint(`recursive-decompose-${parentEntityId}`);
        const createdShapeIdByEntity = new Map<string, TLShapeId>();

        // Create the child shapes
        const shapePartials: TLShapePartial<KGNodeShape>[] = [];
        payload.children.forEach((child, i) => {
          const angleDeg = startAngle + i * step;
          const rad = (angleDeg * Math.PI) / 180;
          const cx = parentBounds.midX + Math.cos(rad) * CHILD_ARC_RADIUS;
          const cy = parentBounds.maxY + Math.sin(rad) * (CHILD_ARC_RADIUS * 0.6) + 40;

          const shapeId = createShapeId(`kg-${child.id}`);
          if (editor.getShape(shapeId)) return; // already exists — skip
          createdShapeIdByEntity.set(child.id, shapeId);

          const normalizedLayer = entityToLayerId({
            layer: child.layer ?? null,
            entity_category: child.entity_category ?? null,
          });

          shapePartials.push({
            id: shapeId,
            type: "kg-node",
            x: cx - w / 2,
            y: cy - h / 2,
            props: {
              w,
              h,
              entityId: child.id,
              name: child.name,
              description: child.description ?? "",
              layer: normalizedLayer,
              category: child.entity_category ?? "concrete",
              tier,
              weight: Math.round(((child.confidence ?? 0.7) as number) * 100),
              isLeverage: false,
              isRisk: false,
              isBottleneck: false,
              isConvergence: false,
              isGhost: true,
              confirmedPulse: 0,
            },
          });
        });

        if (shapePartials.length === 0) return;
        editor.createShapes(shapePartials);

        // Track depth + inherited confidence for each new child
        for (const child of payload.children) {
          depthByEntity.current.set(child.id, parentDepth + 1);
          confidenceByEntity.current.set(child.id, inheritedConfidence);
        }

        // D5b — lateral-at-depth: if the API surfaced sibling
        // entities at the same depth that share convergence chains
        // with the parent, mark them as eligible for an immediate
        // drill at the SAME depth. They've already been processed
        // server-side (they exist in the entity table); we just need
        // to schedule recursive decomposes against them at parentDepth.
        // This implements the "broad-in-a-deep-way" pattern (see
        // docs/KG_DEPTH_CRITIQUE.md §7.1).
        const lateralIds = payload.drill?.lateral_sibling_ids ?? [];
        for (const lateralId of lateralIds) {
          // Lateral siblings sit at the SAME depth as the new
          // children (parentDepth + 1) — they're discovered peers,
          // not descendants. If we haven't processed them yet, mark
          // their depth + give them the same inherited confidence
          // so the gate evaluates them under the same regime.
          if (!depthByEntity.current.has(lateralId)) {
            depthByEntity.current.set(lateralId, parentDepth + 1);
            confidenceByEntity.current.set(lateralId, inheritedConfidence);
          }
        }

        // Wire dashed arrows child → parent for each returned edge
        for (const edge of payload.edges) {
          const fromShapeId =
            createdShapeIdByEntity.get(edge.source_entity_id) ??
            createShapeId(`kg-${edge.source_entity_id}`);
          const toShapeId =
            createdShapeIdByEntity.get(edge.target_entity_id) ??
            createShapeId(`kg-${edge.target_entity_id}`);

          if (!editor.getShape(fromShapeId) || !editor.getShape(toShapeId)) continue;

          const arrowId = createShapeId();
          const arrow: TLShapePartial<TLArrowShape> = {
            id: arrowId,
            type: "arrow",
            props: { color: "grey", size: "s", dash: "dashed" },
          };
          editor.createShapes([arrow]);
          try {
            editor.createBindings([
              {
                fromId: arrowId,
                toId: fromShapeId,
                type: "arrow",
                props: {
                  terminal: "start",
                  normalizedAnchor: { x: 0.5, y: 0.5 },
                  isExact: false,
                  isPrecise: false,
                },
                meta: {},
              },
              {
                fromId: arrowId,
                toId: toShapeId,
                type: "arrow",
                props: {
                  terminal: "end",
                  normalizedAnchor: { x: 0.5, y: 0.5 },
                  isExact: false,
                  isPrecise: false,
                },
                meta: {},
              },
            ]);
          } catch {
            // non-fatal
          }
        }
      } catch (err) {
        console.warn("[recursive-decompose]", err);
      }
    },
    [editor, spaceId],
  );

  // Watch the tldraw store for newly-created ghost KG nodes. When one
  // appears, wait IDLE_MS then run the recursive decompose if gates pass.
  useEffect(() => {
    if (!editor) return;

    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const handleCreate = (shape: KGNodeShape) => {
      const entityId = shape.props.entityId;
      if (!entityId) return;
      if (skip.current.has(entityId)) return;
      if (processed.current.has(entityId)) return;
      if (!enabled) return;

      // Depth: default 0 for unknown (materialized) entities. Children of
      // recursive-decompose are registered in runRecursive, so we won't
      // re-process those.
      const depth = depthByEntity.current.get(entityId) ?? 0;

      // D5b — replace the static MAX_DEPTH cap with a confidence gate.
      // Two ceilings, both must hold:
      //   1. Absolute max depth — safety net regardless of confidence.
      //      We don't currently know if quality holds beyond
      //      ABSOLUTE_MAX_DRILL_DEPTH layers; future telemetry can
      //      raise it.
      //   2. Inherited confidence — if the parent drill returned
      //      should_continue=false (confidence below threshold), the
      //      API has already declined to drill further; we still mark
      //      the entity processed so we don't loop. Confidence == 0
      //      is the implicit "API said stop" signal.
      if (depth >= ABSOLUTE_MAX_DRILL_DEPTH - 1) return;
      const inherited = confidenceByEntity.current.get(entityId);
      // Newly-materialized entities (no inherited confidence) get a
      // first drill — the API computes their parent_quality_score
      // and gates from there. Entities marked with inherited=0 mean
      // a previous drill explicitly stopped here.
      if (inherited === 0) return;

      processed.current.add(entityId);
      const timer = setTimeout(() => {
        timers.delete(entityId);
        void runRecursive(shape.id, entityId, depth);
      }, IDLE_MS);
      timers.set(entityId, timer);
    };

    const unsub = editor.store.listen((event) => {
      for (const record of Object.values(event.changes.added)) {
        if (record.typeName === "shape" && record.type === "kg-node") {
          const kg = record as KGNodeShape;
          if (kg.props.isGhost) handleCreate(kg);
        }
      }
    });

    return () => {
      unsub();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [editor, enabled, runRecursive]);
}
